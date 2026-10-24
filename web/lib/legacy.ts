// The old screens' view of booking v2 (deprecated, delete with them): /api/state's v1 fields, the v1 booking
// shape for the old action routes, and the v1 names a few modules still import (bay, holdMinutes, reservations).
// Everything acts on the viewer's current booking, or on Baywatch Bay 1, which the old screens knew as "the bay".

import { ARRIVAL_GRACE_MS, bookingFee, CLASSES, demandAt, earliestStart, type ReservationType } from './booking-rules.ts';
import type { ReservationView } from './booking-types.ts';
import type { ReservationView as V1View, Status as V1Status } from './reservation.ts';
import type { Schedule } from './schedule.ts';

export const LEGACY_BAY = 'bw-1';

const V1_STATUS: Record<ReservationView['status'], V1Status> = {
  upcoming: 'reserved',
  live: 'reserved',
  arrived: 'arrived',
  charging: 'charging',
  walkup: 'charging',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

// A v2 booking in the v1 shape: other drivers' bookings show only the status and times
export function v1View(v: ReservationView, mine = true): V1View {
  const base = { id: v.id, status: V1_STATUS[v.status], expiresAt: v.arriveBy, end: v.end, mine };
  if (!mine) return base;
  return {
    ...base,
    type: (v.class === 'slow' ? 'slow' : 'fast') as ReservationType,
    createdAt: v.createdAt,
    start: v.start,
    feeCents: v.feeCents,
    demand: v.demand,
    prepaid: false,
    charges: v.charges,
    totalCents: v.totalCents,
    plateHint: v.plateHint ?? null,
    extraPlateHint: v.extraPlateHint ?? null,
    vehicleLabel: v.vehicleLabel ?? '',
    sentReminders: [], // v2's reminder keys mean nothing to the old screens
    blockedSince: v.blockedSince ?? null,
    blockedMs: 0,
    carAtBay: v.carAtBay ?? false,
    ...(v.arrivedAt && { arrivedAt: v.arrivedAt }),
    ...(v.chargingAt && { chargingAt: v.chargingAt }),
    ...(v.endedAt && { endedAt: v.endedAt }),
    ...(v.checkInMethod && { checkInMethod: v.checkInMethod === 'walkup' ? 'fallback' : v.checkInMethod }),
    ...(v.matchedBy && { matchedBy: v.matchedBy }),
  };
}

// "Notify me when it's free" had no v2 equivalent: the old button still toggles, nothing is sent
export const legacyWaitlist = new Set<string>();

export function legacyFacade(schedule: Schedule, holidays: string[]) {
  const info = schedule.bay(LEGACY_BAY) ?? schedule.realBays()[0];
  const bay = { id: info.id, name: info.name, address: info.address, lat: info.lat, lng: info.lng, powerKw: info.powerKw };
  // v1's quote(userId): the fee for the legacy bay from the next block, as the old reserve dialog books it
  const quote = (viewerId?: string | null) => {
    void viewerId;
    const fee = bookingFee(info.class, demandAt(earliestStart(Date.now()), { override: schedule.demand(), holidays }));
    const type: ReservationType = info.class === 'slow' ? 'slow' : 'fast';
    return { type, cents: fee.cents, demand: fee.demand, multiplier: fee.multiplier, prepaid: false, warning: null, noShowCents: fee.cents };
  };
  return { bay, holdMinutes: ARRIVAL_GRACE_MS / 60_000, reservations: { ...schedule, quote }, quote };
}

// /api/state's v1 fields
export async function legacyState(schedule: Schedule, viewerId: string | null, { simulator, hardware }: { simulator: boolean; hardware: unknown }) {
  const info = schedule.bay(LEGACY_BAY) ?? schedule.realBays()[0];
  const { bay, holdMinutes, quote } = legacyFacade(schedule, []);
  const mine = viewerId ? schedule.current(viewerId) : null;
  const here = schedule.onBay(info.id);
  const { maxBlocks, label } = CLASSES[info.class];
  return {
    bay,
    session: {
      type: (info.class === 'slow' ? 'slow' : 'fast') as ReservationType,
      label,
      maxMinutes: maxBlocks * 15,
      presets: [...(simulator ? [15] : []), 30, 60, 90, 120, 180, 240].filter((m) => m <= maxBlocks * 15),
    },
    holdMinutes,
    hardware: hardware as { online: boolean; state: string; mock: boolean; [k: string]: unknown },
    reservation: mine ? v1View(mine.view) : here && here.booking.ownerId !== viewerId ? v1View(here.view, false) : null,
    blockedSince: schedule.operatorBay(info.id).blockedSince,
    waiting: viewerId ? legacyWaitlist.has(viewerId) : false,
    priority: null as { until: number; mine: boolean } | null,
    quote: quote(viewerId),
    log: schedule.log(),
  };
}
