// Operator statistics over the last 7 calendar days, and the "Simulate a week" demo data.
// Pure functions: the reservation store hands in its records, nothing here touches state.

import { cancellationFee, noShowFee, OVERSTAY_GRACE_MS, overstayFee, reservationFee, type ReservationType } from './booking-rules.ts';
import { CHARGE_LABELS, CPO_SHARE, EXTENSION_MS, PRICES, total, type Charge } from './pricing.ts';
import type { Alert, Reservation, Status } from './reservation.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAYS = 7;
const TZ = 'Europe/Berlin'; // the bay's local day, so bars match the operator's calendar

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (at: number) => dayKeyFormat.format(at); // YYYY-MM-DD

// The last 7 calendar days ending today, oldest first. Calendar arithmetic, so a DST week still has 7 days.
export function lastDays(now: number) {
  const [y, m, d] = dayKey(now).split('-').map(Number);
  return Array.from({ length: DAYS }, (_, i) => new Date(Date.UTC(y, m - 1, d - (DAYS - 1 - i))).toISOString().slice(0, 10));
}

export type Day = { day: string; total: number; completed: number; noShow: number; cancelled: number };

export function weekStats(records: Reservation[], alerts: Alert[], now: number) {
  const days: Day[] = lastDays(now).map((day) => ({ day, total: 0, completed: 0, noShow: 0, cancelled: 0 }));
  const inWeek = records.filter((r) => days.some((d) => d.day === dayKey(r.createdAt)));
  for (const r of inWeek) {
    const d = days.find((x) => x.day === dayKey(r.createdAt))!;
    d.total++;
    if (r.status === 'completed') d.completed++;
    if (r.status === 'no_show') d.noShow++;
    if (r.status === 'cancelled') d.cancelled++;
  }

  const ended = inWeek.filter((r) => r.status === 'completed' || r.status === 'cancelled' || r.status === 'no_show');
  const share = (n: number) => (ended.length ? n / ended.length : null);
  const arrived = inWeek.filter((r) => r.arrivedAt);
  const weekAlerts = alerts.filter((a) => days.some((d) => d.day === dayKey(a.since)));
  const revenueCents = inWeek.reduce((sum, r) => sum + total(r.charges), 0);

  return {
    days,
    simulated: inWeek.some((r) => r.simulated) || weekAlerts.some((a) => a.simulated),
    kpis: {
      reservations: inWeek.length,
      ended: ended.length,
      completionRate: share(ended.filter((r) => r.status === 'completed').length),
      noShowRate: share(ended.filter((r) => r.status === 'no_show').length),
      avgArriveMs: arrived.length ? arrived.reduce((sum, r) => sum + (r.arrivedAt! - r.createdAt), 0) / arrived.length : null,
      blockedIncidents: weekAlerts.length,
      blockedMinutes: Math.round(weekAlerts.reduce((sum, a) => sum + ((a.resolvedAt ?? now) - a.since), 0) / MIN),
      cameraCheckIns: arrived.filter((r) => r.checkInMethod === 'camera').length,
      fallbackCheckIns: arrived.filter((r) => r.checkInMethod === 'fallback').length,
      fuzzyMatches: arrived.filter((r) => r.matchedBy === 'fuzzy').length,
      revenueCents,
      cpoShareCents: Math.round(revenueCents * CPO_SHARE),
    },
  };
}
export type WeekStats = ReturnType<typeof weekStats>;

// Small seeded PRNG (mulberry32): the same seed gives the same week, so demos are repeatable
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A plausible week of bookings for the demo, priced and charged by the same rules as real ones: about 70%
// completed, the rest cancelled or no-shows; mostly camera check-ins with some misreads and fallbacks; the odd
// blocked bay and overstay; fees across the demand tiers.
// Seed 11 is the default because it gives a representative mix of all of those.
export function simulateWeek(
  now: number,
  { type, graceMs }: { type: ReservationType; graceMs: number },
  seed = 11,
): { records: Reservation[]; alerts: Alert[] } {
  const rnd = random(seed);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const demandMix = [0.15, 0.5, 0.5, 0.5, 0.8, 0.95]; // mostly normal, some quiet, busy and peak slots
  const lengths = (type === 'fast' ? [30, 60, 90, 120] : [60, 120, 180, 240]).map((m) => m * MIN);
  const records: Reservation[] = [];
  const alerts: Alert[] = [];
  let n = 0;

  for (const day of lastDays(now)) {
    const [y, m, d] = day.split('-').map(Number);
    const noon = Date.UTC(y, m - 1, d, 11); // about noon in Berlin
    const count = Math.floor(between(4, 10));
    for (let i = 0; i < count; i++) {
      const createdAt = Math.round(noon + between(-4.5, 7.5) * HOUR);
      if (createdAt > now - 30 * MIN) continue; // nothing in the future, nothing still running
      const roll = rnd();
      const status: Status = roll < 0.7 ? 'completed' : roll < 0.86 ? 'cancelled' : 'no_show';
      const fee = reservationFee(type, pick(demandMix));
      const charges: Charge[] = [{ kind: 'reservation', label: CHARGE_LABELS.reservation(type, fee.demand), cents: fee.cents, at: createdAt }];
      const r: Reservation = {
        id: `sim-${day}-${i}`,
        ownerId: `sim:driver-${++n}`,
        plate: null,
        extraPlate: null,
        vehicleLabel: 'Simulated driver',
        status,
        type,
        createdAt,
        start: createdAt,
        end: createdAt + pick(lengths),
        expiresAt: createdAt + graceMs,
        feeCents: fee.cents,
        demand: fee.demand,
        prepaid: false,
        reminders: [],
        sentReminders: [],
        blockedSince: null,
        blockedMs: 0,
        charges,
        simulated: true,
      };
      if (status === 'completed') {
        if (rnd() < 0.15) {
          r.extendedAt = createdAt + 5 * MIN;
          r.expiresAt += EXTENSION_MS;
          charges.push({ kind: 'extension', label: CHARGE_LABELS.extension(), cents: PRICES.extension, at: r.extendedAt });
        }
        if (rnd() < 0.12) {
          // another car stood in the bay for a while before the driver could check in
          r.blockedMs = Math.round(between(3, 12) * MIN);
          const since = createdAt + Math.round(between(1, 4) * MIN);
          alerts.push({ id: `sim-alert-${r.id}`, since, reservationId: r.id, plate: null, status: 'resolved', resolvedAt: since + r.blockedMs, resolvedBy: rnd() < 0.6 ? 'camera' : 'operator', emailStatus: 'sent', simulated: true });
        }
        r.arrivedAt = createdAt + Math.round(between(4, 14) * MIN) + r.blockedMs;
        const fallback = rnd() < 0.12;
        r.checkInMethod = fallback ? 'fallback' : 'camera';
        if (!fallback) r.matchedBy = rnd() < 0.12 ? 'fuzzy' : 'exact';
        r.chargingAt = r.arrivedAt + Math.round(between(1, 3) * MIN);
        // most leave before the session ends, some overstay; nobody leaves in the future
        r.endedAt = Math.min(now - MIN, Math.max(r.chargingAt + 15 * MIN, r.end + Math.round(between(-40, 30) * MIN)));
        const over = overstayFee(type, r.end, r.endedAt);
        if (over) charges.push({ kind: 'overstay', label: CHARGE_LABELS.overstay(Math.ceil((r.endedAt - r.end - OVERSTAY_GRACE_MS) / MIN)), cents: over, at: r.endedAt });
      } else if (status === 'cancelled') {
        r.endedAt = createdAt + Math.round(between(0.5, 8) * MIN);
        const kept = cancellationFee(fee.cents, { bookedAt: createdAt, start: createdAt, cancelledAt: r.endedAt });
        const label = kept ? CHARGE_LABELS.cancelRelease(kept) : CHARGE_LABELS.refundEarly();
        charges.push({ kind: kept ? 'released' : 'refund', label, cents: kept - total(charges), at: r.endedAt });
      } else {
        r.endedAt = r.expiresAt;
        charges.push({ kind: 'released', label: CHARGE_LABELS.noShowRelease(), cents: noShowFee(fee.cents) - fee.cents, at: r.endedAt });
      }
      records.push(r);
    }
  }
  return { records, alerts };
}
