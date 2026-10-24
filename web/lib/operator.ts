// Operator statistics over the last 7 calendar days, the "Simulate a week" demo data, and the hardware panel.
// Pure functions: the engine (schedule.ts) hands in its records, nothing here touches state.

import {
  BLOCK_MS,
  BLOCKED_CREDIT_CENTS,
  bookingFee,
  cancelCents,
  CLASSES,
  demandAt,
  idleFee,
  idleMinutes,
  MIN_GAP_MS,
  OVERSTAY_OPERATOR_SHARE,
} from './booking-rules.ts';
import type { BayInfo } from './bays.ts';
import type { HardwareStatus } from './ecurious.ts';
import { CPO_SHARE, RECEIPT, total } from './pricing.ts';
import type { Alert, Booking } from './schedule.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAYS = 7;
const TZ = 'Europe/Berlin'; // the bays' local day, so bars match the operator's calendar

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (at: number) => dayKeyFormat.format(at); // YYYY-MM-DD

// The last 7 calendar days ending today, oldest first. Calendar arithmetic, so a DST week still has 7 days.
export function lastDays(now: number) {
  const [y, m, d] = dayKey(now).split('-').map(Number);
  return Array.from({ length: DAYS }, (_, i) => new Date(Date.UTC(y, m - 1, d - (DAYS - 1 - i))).toISOString().slice(0, 10));
}

export type Day = { day: string; total: number; completed: number; noShow: number; cancelled: number };

const overstayOf = (b: Booking) => b.charges.filter((c) => c.kind === 'overstay').reduce((sum, c) => sum + c.cents, 0);

// Bookings count on the day of their start; walk-ups are counted apart, as they're free
export function weekStats(records: Booking[], alerts: Alert[], now: number) {
  const days: Day[] = lastDays(now).map((day) => ({ day, total: 0, completed: 0, noShow: 0, cancelled: 0 }));
  const inWeek = records.filter((r) => days.some((d) => d.day === dayKey(r.start)) && r.start <= now);
  const bookings = inWeek.filter((r) => r.kind === 'booking');
  for (const r of bookings) {
    const d = days.find((x) => x.day === dayKey(r.start))!;
    d.total++;
    if (r.status === 'completed') d.completed++;
    if (r.status === 'no_show') d.noShow++;
    if (r.status === 'cancelled') d.cancelled++;
  }

  const ended = bookings.filter((r) => r.status === 'completed' || r.status === 'cancelled' || r.status === 'no_show');
  const share = (n: number) => (ended.length ? n / ended.length : null);
  const arrived = bookings.filter((r) => r.arrivedAt);
  const weekAlerts = alerts.filter((a) => days.some((d) => d.day === dayKey(a.since)));
  const revenueCents = inWeek.reduce((sum, r) => sum + total(r.charges), 0);
  const overstayCents = inWeek.reduce((sum, r) => sum + overstayOf(r), 0);
  const operatorOverstay = Math.round(overstayCents * OVERSTAY_OPERATOR_SHARE);

  return {
    days,
    simulated: inWeek.some((r) => r.simulated) || weekAlerts.some((a) => a.simulated),
    kpis: {
      reservations: bookings.length,
      walkups: inWeek.filter((r) => r.kind === 'walkup').length,
      ended: ended.length,
      completionRate: share(ended.filter((r) => r.status === 'completed').length),
      noShowRate: share(ended.filter((r) => r.status === 'no_show').length),
      avgArriveMs: arrived.length ? arrived.reduce((sum, r) => sum + (r.arrivedAt! - r.start), 0) / arrived.length : null, // vs the start
      blockedIncidents: weekAlerts.length,
      blockedMinutes: Math.round(weekAlerts.reduce((sum, a) => sum + ((a.resolvedAt ?? now) - a.since), 0) / MIN),
      cameraCheckIns: arrived.filter((r) => r.checkInMethod === 'camera').length,
      fallbackCheckIns: arrived.filter((r) => r.checkInMethod === 'fallback').length,
      fuzzyMatches: arrived.filter((r) => r.matchedBy === 'fuzzy').length,
      revenueCents, // money drivers paid: fees after credit and refunds, plus idle fees
      overstayCents,
      overstaySplit: { operatorCents: operatorOverstay, platformCents: overstayCents - operatorOverstay },
      creditsIssuedCents: inWeek.reduce((sum, r) => sum + r.creditGrantedCents, 0), // €5 for a blocked bay
      creditsUsedCents: inWeek.reduce((sum, r) => sum + r.creditUsedCents, 0), // incl. free first reservations
      cpoShareCents: Math.round((revenueCents - overstayCents) * CPO_SHARE) + operatorOverstay,
    },
    bays: [...new Set(inWeek.map((r) => r.bayId))].sort().map((bayId) => {
      const mine = inWeek.filter((r) => r.bayId === bayId);
      return {
        bayId,
        reservations: mine.filter((r) => r.kind === 'booking').length,
        completed: mine.filter((r) => r.kind === 'booking' && r.status === 'completed').length,
        noShows: mine.filter((r) => r.status === 'no_show').length,
        walkups: mine.filter((r) => r.kind === 'walkup').length,
        revenueCents: mine.reduce((sum, r) => sum + total(r.charges), 0),
      };
    }),
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

// A plausible week on the Baywatch bays for the demo, priced and charged by the same rules as real bookings:
// mostly completed, some cancelled at every tier, a few no-shows, walk-ups, the odd blocked bay (with its €5
// credit) and overstay; camera check-ins with some misreads and fallbacks. Bookings never overlap on a bay.
// Seed 11 is the default because it gives a representative mix of all of those.
export function simulateWeek(now: number, bays: Pick<BayInfo, 'id' | 'name' | 'real' | 'guard' | 'class'>[], seed = 11): { records: Booking[]; alerts: Alert[] } {
  const rnd = random(seed);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const records: Booking[] = [];
  const alerts: Alert[] = [];
  let n = 0;

  for (const bay of bays) {
    const max = CLASSES[bay.class].maxBlocks;
    for (const day of lastDays(now)) {
      const [y, m, d] = day.split('-').map(Number);
      let start = Date.UTC(y, m - 1, d, 6) + Math.floor(between(0, 8)) * BLOCK_MS; // from about 07:00 in Berlin
      const last = Date.UTC(y, m - 1, d, 20);
      while (start < last) {
        const blocks = Math.min(max, pick([2, 4, 4, 6, 8]));
        const end = start + blocks * BLOCK_MS;
        if (end + 30 * MIN > now) break; // nothing in the future, nothing still running
        const roll = rnd();
        const kind: Booking['kind'] = roll < 0.1 ? 'walkup' : 'booking';
        const status: Booking['status'] = kind === 'walkup' || roll < 0.78 ? 'completed' : roll < 0.9 ? 'cancelled' : 'no_show';
        const fee = kind === 'walkup' ? { cents: 0, demand: 'Normal' as const } : bookingFee(bay.class, demandAt(start));
        const createdAt = kind === 'walkup' ? start : start - Math.round(between(0.2, 50)) * HOUR;
        const firstFree = kind === 'booking' && rnd() < 0.06;
        const r: Booking = {
          id: `sim-${bay.id}-${++n}`,
          bayId: bay.id,
          bay: { name: bay.name, real: bay.real, guard: bay.guard, class: bay.class },
          ownerId: `sim:driver-${n}`,
          kind,
          status,
          plate: null,
          extraPlate: null,
          vehicleLabel: kind === 'walkup' ? 'Walk-up' : 'Simulated driver',
          createdAt,
          start,
          end,
          blocks,
          feeCents: fee.cents,
          demand: fee.demand,
          creditUsedCents: firstFree ? fee.cents : 0,
          firstFreeUsed: firstFree,
          creditGrantedCents: 0,
          blockedSince: null,
          blockedMs: 0,
          reminders: [],
          sentReminders: [],
          charges: [],
          armed: true,
          simulated: true,
        };
        const charge = (kindOf: Booking['charges'][number]['kind'], label: string, cents: number, at: number) => r.charges.push({ kind: kindOf, label, cents, at });
        if (kind === 'booking') {
          charge('reservation', RECEIPT.fee(bay.class, fee.demand), fee.cents, createdAt);
          if (firstFree) charge('credit', RECEIPT.firstFree(), -fee.cents, createdAt);
        }
        if (status === 'completed') {
          if (kind === 'booking' && rnd() < 0.08) {
            // another car stood in the bay for a while before the driver could check in
            r.blockedMs = Math.round(between(3, 12)) * MIN;
            r.creditGrantedCents = BLOCKED_CREDIT_CENTS;
            const since = start - 5 * MIN;
            alerts.push({ id: `sim-alert-${r.id}`, bayId: bay.id, since, bookingId: r.id, plate: null, status: 'resolved', resolvedAt: since + r.blockedMs, resolvedBy: rnd() < 0.6 ? 'sensor' : 'operator', emailStatus: 'sent', simulated: true });
          }
          r.arrivedAt = kind === 'walkup' ? start : start + Math.round(between(-8, 12)) * MIN + r.blockedMs;
          const fallback = kind === 'booking' && rnd() < 0.1;
          r.checkInMethod = kind === 'walkup' ? 'walkup' : fallback ? 'fallback' : 'camera';
          if (r.checkInMethod === 'camera') r.matchedBy = rnd() < 0.12 ? 'fuzzy' : 'exact';
          r.chargingAt = r.arrivedAt + Math.round(between(1, 3)) * MIN;
          // most leave before the end, some overstay past the 5 free minutes; nobody leaves in the future
          r.endedAt = Math.min(now - MIN, Math.max(r.chargingAt + 15 * MIN, end + Math.round(between(-30, 20)) * MIN));
          const idle = idleFee(end, r.endedAt);
          if (idle) charge('overstay', RECEIPT.idle(idleMinutes(end, r.endedAt)), idle, r.endedAt);
        } else if (status === 'cancelled') {
          r.endedAt = Math.min(start - MIN, createdAt + Math.round(between(1, Math.max(2, (start - createdAt) / MIN))) * MIN);
          const due = cancelCents(fee.cents, { bookedAt: createdAt, start, at: r.endedAt });
          if (!firstFree && fee.cents - due > 0) charge(due ? 'released' : 'refund', due ? RECEIPT.cancelRelease(due) : RECEIPT.refundAhead(), due - fee.cents, r.endedAt);
        } else {
          r.endedAt = start + 15 * MIN + MIN; // the arrival deadline passed: the whole fee is kept
        }
        records.push(r);
        start = blockAfter(Math.max(end, r.endedAt ?? end) + MIN_GAP_MS) + Math.floor(between(0, 6)) * BLOCK_MS;
      }
    }
  }
  return { records, alerts };
}

const blockAfter = (t: number) => Math.ceil(t / BLOCK_MS) * BLOCK_MS;

// A bay's hardware on the dashboard: the guard, what to warn about and, with real hardware, the device's
// readings. `inSession`: a driver is checked in. `time` formats a timestamp for the viewer. Never holds a plate.
// Between sessions the arm is meant to be up (booking v2), so an arm down with nobody in is the warning.
export function hardwarePanel(hw: HardwareStatus, inSession: boolean, time: (at: number) => string) {
  const guard = hw.state === 'unknown' ? 'unknown' : hw.state === 'blocked' ? 'up' : 'down';
  const warnings = [
    hw.autoUnlock === 'any' && 'The camera lowers the arm for any car: the hold isn’t enforced.',
    !hw.mock && hw.state === 'free' && !inSession && 'The arm is down with nobody checked in: the bay isn’t guarded.',
  ].filter((w): w is string => !!w);
  const rows: [string, string][] = hw.mock
    ? []
    : [
        ['Lock', hw.lockId ?? '–'],
        ['Car sensor', hw.carPresence ?? '–'],
        ['Live events', hw.events ? 'on' : 'off'],
        ['12 V battery', hw.battery12V == null ? '–' : `${hw.battery12V.toFixed(1)} V`],
        ['Signal', hw.signalStrength4G == null ? '–' : String(hw.signalStrength4G)],
        ['Water', hw.waterIngress == null ? '–' : hw.waterIngress ? 'detected' : 'dry'],
        ['Errors', hw.activeErrors?.length ? hw.activeErrors.join(', ') : 'none'],
        ['Last seen', hw.lastSeenAt ? time(Date.parse(hw.lastSeenAt)) : '–'],
        ...(hw.stale ? [['Reading', `stale since ${hw.updatedAt ? time(hw.updatedAt) : 'the start'}: ${hw.error ?? 'no answer'}`] as [string, string]] : []),
      ];
  return { guard, online: hw.online !== false, warnings, rows };
}
