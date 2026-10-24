// Reservation lifecycle for one Ecurious bay, "reserve now": the session starts when the driver books.
// reserved → arrived (camera or fallback check-in, bay released) → charging → completed
// reserved → cancelled | no_show (arrival deadline passed)
// Fees, deadlines and reminders come from booking-rules.ts. Around them: one paid extension, a waitlist
// with a priority window, blocked-bay detection (pauses the hold and alerts the operator), and plate
// matching that tolerates misreads.

import {
  arrivalDeadline,
  assessReliability,
  cancellationFee,
  isNoShow,
  noShowFee,
  notificationSchedule,
  OVERSTAY_GRACE_MS,
  overstayFee,
  reservationFee,
  slotError,
  type Reminder,
  type ReminderKey,
  type ReservationType,
} from './booking-rules.ts';
import { distanceM } from './geo.ts';
import { CHARGE_LABELS, EXTENSION_MIN, EXTENSION_MS, formatEuro, PRICES, total, type Charge } from './pricing.ts';
import { maskPlate, normalizePlate, samePlate } from './plates.ts';

export type Status = 'reserved' | 'arrived' | 'charging' | 'completed' | 'cancelled' | 'no_show';
export type Direction = 'in' | 'out';

export interface Hardware {
  reserve(): Promise<unknown>;
  release(): Promise<unknown>;
}

type Point = { lat: number; lng: number };

export type Alert = {
  id: string;
  since: number;
  reservationId: string;
  plate: string | null; // operators only; erased on resolve and never emailed
  status: 'open' | 'resolved';
  resolvedAt?: number;
  resolvedBy?: 'camera' | 'operator';
  emailStatus: 'pending' | 'sent' | 'skipped' | 'failed';
  simulated?: boolean; // "Simulate a week" demo data
};

export interface Reservation {
  id: string;
  ownerId: string; // the signed-in driver (Clerk user id); never sent to clients
  plate: string | null;
  extraPlate: string | null; // "different car today"
  vehicleLabel: string;
  status: Status;
  type: ReservationType;
  createdAt: number;
  start: number; // session start: the booking time
  end: number; // session end, picked by the driver within the type's maximum
  expiresAt: number; // arrival deadline: start + grace, moved by the extension and while the bay is blocked
  feeCents: number; // fixed at booking, shown before paying
  demand: string; // the demand tier the fee was priced at
  prepaid: boolean; // repeat no-shows: the whole fee is kept on a no-show
  reminders: Reminder[]; // still to fall due (notificationSchedule)
  sentReminders: { key: ReminderKey; at: number }[];
  extendedAt?: number;
  unreadableAt?: number; // camera saw a car it couldn't read: the app offers the fallback check-in
  blockedSince: number | null; // hold is paused while another car stands in the bay
  blockedMs: number;
  arrivedAt?: number;
  checkInMethod?: 'camera' | 'fallback';
  matchedBy?: 'exact' | 'fuzzy';
  chargingAt?: number;
  endedAt?: number;
  charges: Charge[];
  simulated?: boolean; // "Simulate a week" demo data, owned by a fake `sim:` driver
}

// What the owner sees on top of the public fields
type OwnerDetails = Omit<Reservation, 'id' | 'ownerId' | 'plate' | 'extraPlate' | 'status' | 'expiresAt' | 'end' | 'simulated' | 'reminders'> & {
  plateHint: string | null;
  extraPlateHint: string | null;
  totalCents: number;
};
export type ReservationView = { id: string; status: Status; expiresAt: number; end: number; mine: boolean } & Partial<OwnerDetails>;
export type LogEntry = { at: number; type: string; detail: string };

export const ACTIVE = new Set<Status>(['reserved', 'arrived', 'charging']);
const HISTORY_CAP = 300;
export const PRIORITY_MS = 2 * 60_000;
export const FALLBACK_RADIUS_M = 150;

export const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const REMINDER_NOTES: Record<ReminderKey, string> = {
  starts_in_1d: 'driver reminded: booking tomorrow',
  starts_in_2h: 'driver reminded: booking in 2 h',
  starts_in_15m: 'driver reminded: booking in 15 min',
  ends_in_1h: 'driver reminded: session ends in 1 h',
  ends_in_15m: 'driver reminded: 15 min of the session left',
};

// Other drivers only learn that the bay is busy and until when, never whose car it is
function view(r: Reservation, viewerId: string | null): ReservationView {
  const base = { id: r.id, status: r.status, expiresAt: r.expiresAt, end: r.end, mine: r.ownerId === viewerId };
  if (!base.mine) return base;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ownerId and raw plates must never leave the server
  const { ownerId, plate, extraPlate, simulated, reminders, ...rest } = r;
  return {
    ...rest,
    ...base,
    plateHint: plate && maskPlate(plate),
    extraPlateHint: extraPlate && maskPlate(extraPlate),
    totalCents: total(r.charges),
  };
}

export function createReservations({
  hw,
  bay,
  type,
  holdMs,
  now = Date.now,
  onAlert = () => {},
}: {
  hw: Hardware;
  bay: Point;
  type: ReservationType; // from the bay's charger: fast (DC) or slow (AC)
  holdMs?: number; // overrides the arrival grace, for short demo holds
  now?: () => number;
  onAlert?: (alert: Alert) => void;
}) {
  // ponytail: one bay, in memory. Key by bay id and move to a DB once there are more bays.
  let current: Reservation | null = null;
  const history: Reservation[] = []; // ended reservations, plates already erased
  const alerts: Alert[] = [];
  const log: LogEntry[] = [];
  let blocker: { since: number } | null = null; // a car without a booking is standing in the bay
  const waitlist: string[] = [];
  let priority: { userId: string; until: number } | null = null;
  let occupancy: number | undefined; // share of the site in use; none yet = priced as normal demand

  const deadline = (start: number) => (holdMs === undefined ? arrivalDeadline(start) : start + holdMs);
  const reliability = (ownerId: string) =>
    assessReliability(history.filter((h) => h.ownerId === ownerId).map(({ status, endedAt }) => ({ status, endedAt })), now());

  // the log never holds plates, so it can be shown and kept for the demo
  const note = (type: string, detail = '') => {
    log.unshift({ at: now(), type, detail });
    log.length = Math.min(log.length, 30);
  };

  const active = () => (current && ACTIVE.has(current.status) ? current : null);
  const held = () => (priority && now() < priority.until ? priority : null);
  const addCharge = (r: Reservation, kind: Charge['kind'], label: string, cents: number) =>
    r.charges.push({ kind, label, cents, at: now() });

  // the current reservation, if it's in one of these states and belongs to this driver
  const own = (ownerId: string, ...statuses: Status[]): Reservation => {
    if (!current || !statuses.includes(current.status)) fail(409, `No reservation in state: ${statuses.join(' / ')}`);
    if (current!.ownerId !== ownerId) fail(403, 'This reservation belongs to another driver');
    return current!;
  };

  // When the bay becomes free, the first driver on the waitlist gets it first, for a short window
  function offerToNextInLine() {
    if (active() || blocker || held()) return;
    const next = waitlist.shift();
    priority = next ? { userId: next, until: now() + PRIORITY_MS } : null;
    if (next) note('priority', `bay held ${PRIORITY_MS / 60_000} min for the next driver on the waitlist`);
  }

  // GDPR: drop the plates as soon as the reservation is over
  function end(r: Reservation, status: Status) {
    if (r.blockedSince !== null) r.blockedMs += now() - r.blockedSince;
    Object.assign(r, { status, endedAt: now(), plate: null, extraPlate: null, blockedSince: null });
    history.unshift(r);
    history.length = Math.min(history.length, HISTORY_CAP);
    offerToNextInLine();
  }

  // Bring a reserved bay back from "blocked": resume the paused hold and close the alerts
  function unblock(by: 'camera' | 'operator') {
    const r = active();
    if (r?.blockedSince != null) {
      const paused = now() - r.blockedSince;
      r.expiresAt += paused;
      r.blockedMs += paused;
      r.blockedSince = null;
    }
    blocker = null;
    for (const a of alerts) {
      if (a.status === 'open') Object.assign(a, { status: 'resolved', resolvedAt: now(), resolvedBy: by, plate: null });
    }
    note('bay_clear', by === 'camera' ? 'the other car left' : 'operator cleared the bay');
    offerToNextInLine();
  }

  function block(r: Reservation, plate: string) {
    blocker = { since: now() };
    r.blockedSince = now();
    const alert: Alert = { id: crypto.randomUUID(), since: now(), reservationId: r.id, plate, status: 'open', emailStatus: 'pending' };
    alerts.unshift(alert);
    alerts.length = Math.min(alerts.length, 100);
    note('bay_blocked', 'another car is in the reserved bay: hold paused, operator alerted');
    onAlert(alert);
  }

  async function release(undo: () => void) {
    try {
      await hw.release();
    } catch (e) {
      undo();
      fail(502, `Could not release the bay: ${message(e)}`);
    }
  }

  // The price and terms a driver would book at right now (the fee is fixed at booking)
  function quote(viewerId: string | null) {
    const fee = reservationFee(type, occupancy);
    const rel = viewerId ? reliability(viewerId) : { prepayRequired: false, warning: null };
    return { type, ...fee, prepaid: rel.prepayRequired, warning: rel.warning, noShowCents: noShowFee(fee.cents, rel.prepayRequired) };
  }

  // Demo control (SIMULATOR=1): the site's demand drives the price
  function setOccupancy(share: number | undefined) {
    occupancy = share;
    note('demand', `site demand set to ${reservationFee(type, share).demand.toLowerCase()}`);
    return quote(null);
  }

  // `expectedCents` is the price the driver saw: if demand moved it since, they confirm again
  async function reserve(ownerId: string, rawPlate: unknown, vehicleLabel: string, durationMs: unknown, expectedCents?: unknown) {
    const plate = normalizePlate(rawPlate);
    if (plate.length < 2 || plate.length > 10) fail(400, 'Enter a valid license plate');
    const start = now();
    const length = Number(durationMs);
    const slot = Number.isFinite(length) ? slotError(type, start, start + length, start) : 'Choose how long you want to charge';
    if (slot) fail(400, slot);
    if (blocker) fail(409, 'A car is in the bay right now');
    if (active()) fail(409, 'Bay is already reserved');
    if (held() && held()!.userId !== ownerId) fail(409, 'Held for a waiting driver');
    const q = quote(ownerId);
    if (expectedCents !== undefined && expectedCents !== q.cents) fail(409, `The price is now ${formatEuro(q.cents)}. Check it and reserve again.`);
    const prev = current;
    // set before the await so a second request can't reserve the same bay meanwhile
    const r: Reservation = {
      id: crypto.randomUUID(),
      ownerId,
      plate,
      extraPlate: null,
      vehicleLabel,
      status: 'reserved',
      type,
      createdAt: start,
      start,
      end: start + length,
      expiresAt: deadline(start),
      feeCents: q.cents,
      demand: q.demand,
      prepaid: q.prepaid,
      reminders: notificationSchedule(start, start, start + length),
      sentReminders: [],
      blockedSince: null,
      blockedMs: 0,
      charges: [],
    };
    addCharge(r, 'reservation', CHARGE_LABELS.reservation(type, q.demand), q.cents);
    current = r;
    try {
      await hw.reserve();
    } catch (e) {
      current = prev;
      fail(502, `Reservation hardware did not respond: ${message(e)}`);
    }
    priority = null;
    if (waitlist.includes(ownerId)) waitlist.splice(waitlist.indexOf(ownerId), 1);
    note('reserved', `bay blocked: arrive within ${Math.round((r.expiresAt - start) / 60_000)} min${r.prepaid ? ', prepaid' : ''}`);
    return view(r, ownerId);
  }

  // Idle time after the session's end (plus grace) is billed when the car leaves or the driver finishes
  function chargeOverstay(r: Reservation) {
    const cents = overstayFee(r.type, r.end, now());
    if (cents > 0) addCharge(r, 'overstay', CHARGE_LABELS.overstay(Math.ceil((now() - r.end - OVERSTAY_GRACE_MS) / 60_000)), cents);
  }

  // Reminders fall due on the timer and are re-checked then: start reminders only while still reserved,
  // end reminders only once the car is in the bay. Each fires once; one that no longer fits is dropped.
  function sendDueReminders(r: Reservation) {
    while (r.reminders.length && r.reminders[0].at <= now()) {
      const { key } = r.reminders.shift()!;
      const fits = key.startsWith('ends') ? r.status === 'arrived' || r.status === 'charging' : r.status === 'reserved';
      if (!fits) continue;
      r.sentReminders.push({ key, at: now() });
      note('reminder', REMINDER_NOTES[key]);
    }
  }

  // Called for every car the camera sees entering ('in') or leaving ('out') the bay.
  // An empty plate means the camera saw a car but couldn't read it.
  async function plateEvent(rawPlate: unknown, direction: Direction = 'in') {
    const r = active();
    const read = normalizePlate(rawPlate);
    const match = r && read ? (samePlate(read, r.plate) ?? samePlate(read, r.extraPlate)) : null;

    if (direction === 'out') {
      if (r && match && (r.status === 'arrived' || r.status === 'charging')) {
        chargeOverstay(r);
        end(r, 'completed');
        note('completed', 'car left, bay is free');
        return { matched: true };
      }
      if (blocker && !match) unblock('camera');
      return { matched: false };
    }

    if (r?.status !== 'reserved') {
      // nobody booked: a car parking here is ordinary charging, so no alert, but the bay is taken
      if (!r && !blocker) {
        blocker = { since: now() };
        note('bay_occupied', 'a car without a booking is in the bay');
      }
      return { matched: false };
    }
    if (!read) {
      r.unreadableAt = now();
      note('unreadable_plate', 'camera saw a car but could not read the plate');
      return { matched: false };
    }
    if (!match) {
      if (!blocker) block(r, read);
      return { matched: false };
    }
    // the booked car is in the bay, so whatever blocked it has gone
    if (blocker) unblock('camera');
    r.status = 'arrived';
    await release(() => (r.status = 'reserved'));
    Object.assign(r, { arrivedAt: now(), checkInMethod: 'camera', matchedBy: match });
    note('checked_in', match === 'exact' ? 'plate matched, bay released' : 'plate matched despite a misread, bay released');
    return { matched: true, matchedBy: match };
  }

  // "I'm at the bay": check in without the camera, from within FALLBACK_RADIUS_M of the bay.
  // ponytail: browser geolocation can be spoofed; on site, use a code on the hardware display or a QR sticker.
  async function checkInManually(ownerId: string, pos: { lat?: unknown; lng?: unknown }) {
    const r = own(ownerId, 'reserved');
    const here = { lat: Number(pos?.lat), lng: Number(pos?.lng) };
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) fail(400, 'Your location is needed to check in');
    if (blocker) fail(409, 'Another car is in the bay');
    if (distanceM(bay, here) > FALLBACK_RADIUS_M) fail(403, `Check in from the bay (within ${FALLBACK_RADIUS_M} m)`);
    r.status = 'arrived';
    await release(() => (r.status = 'reserved'));
    Object.assign(r, { arrivedAt: now(), checkInMethod: 'fallback' });
    note('checked_in', 'driver checked in at the bay, bay released');
    return view(r, ownerId); // the coordinates are not kept
  }

  // "Different car today": the camera also accepts this plate until the booking ends
  function useOtherPlate(ownerId: string, rawPlate: unknown) {
    const r = own(ownerId, 'reserved');
    const plate = normalizePlate(rawPlate);
    if (plate.length < 2 || plate.length > 10) fail(400, 'Enter a valid license plate');
    r.extraPlate = plate;
    note('other_plate', 'driver added a second plate for this booking');
    return view(r, ownerId);
  }

  function extend(ownerId: string) {
    const r = own(ownerId, 'reserved');
    if (r.extendedAt) fail(409, 'A booking can be extended once');
    r.extendedAt = now();
    r.expiresAt += EXTENSION_MS;
    addCharge(r, 'extension', CHARGE_LABELS.extension(), PRICES.extension);
    note('extended', `hold extended by ${EXTENSION_MIN} min`);
    return view(r, ownerId);
  }

  // The cancellation tiers from booking-rules.ts; free while another car blocks the bay (not the driver's fault).
  // Everything paid comes back except the cancellation fee.
  async function cancel(ownerId: string) {
    const r = own(ownerId, 'reserved');
    const blocked = r.blockedSince !== null;
    const fee = blocked ? 0 : cancellationFee(r.feeCents, { bookedAt: r.createdAt, start: r.start, cancelledAt: now() });
    await hw.release();
    const back = total(r.charges) - fee;
    if (back > 0) {
      const label = fee ? CHARGE_LABELS.cancelRelease(fee) : blocked ? CHARGE_LABELS.refundBlocked() : CHARGE_LABELS.refundEarly();
      addCharge(r, fee ? 'released' : 'refund', label, -back);
    }
    end(r, 'cancelled');
    note('cancelled', 'bay released');
    return view(r, ownerId);
  }

  function startCharging(ownerId: string) {
    const r = own(ownerId, 'arrived');
    Object.assign(r, { status: 'charging', chargingAt: now() });
    note('charging');
    return view(r, ownerId);
  }

  function finish(ownerId: string) {
    const r = own(ownerId, 'arrived', 'charging');
    chargeOverstay(r);
    end(r, 'completed');
    note('completed', 'bay is free');
    return view(r, ownerId);
  }

  // Runs on a timer: priority windows, due reminders, and the no-show release
  async function expire() {
    if (priority && now() >= priority.until) {
      priority = null;
      offerToNextInLine();
    }
    const r = current;
    if (!r || !ACTIVE.has(r.status)) return;
    sendDueReminders(r);
    if (r.status !== 'reserved' || r.blockedSince !== null) return; // a blocked bay pauses the hold
    if (!isNoShow(r.expiresAt, now())) return;
    try {
      await hw.release();
    } catch (e) {
      note('error', `release after no-show failed, retrying: ${message(e)}`);
      return;
    }
    // half the fee comes back, unless the driver had to prepay
    if (!r.prepaid) addCharge(r, 'released', CHARGE_LABELS.noShowRelease(), -(r.feeCents - noShowFee(r.feeCents)));
    end(r, 'no_show');
    note('no_show', r.prepaid ? 'arrival deadline passed, bay released, prepaid fee kept' : 'arrival deadline passed, bay released');
  }

  function notifyWhenFree(userId: string) {
    if (active()?.ownerId === userId) fail(409, 'This bay is already yours');
    const h = held();
    if (h?.userId === userId) fail(409, 'The bay is held for you, reserve it now');
    if (!active() && !blocker && !h) fail(409, 'The bay is free, reserve it now');
    if (!waitlist.includes(userId)) waitlist.push(userId);
    note('waitlist', 'a driver asked to be told when the bay is free');
    return { position: waitlist.indexOf(userId) + 1 };
  }

  function leaveWaitlist(userId: string) {
    if (waitlist.includes(userId)) waitlist.splice(waitlist.indexOf(userId), 1);
    if (priority?.userId === userId) {
      priority = null;
      offerToNextInLine();
    }
    return { ok: true };
  }

  function resolveAlert(id: string) {
    const a = alerts.find((x) => x.id === id) ?? fail(404, 'Alert not found');
    if (a.status !== 'open') fail(409, 'This alert is already resolved');
    unblock('operator');
    return { ...a };
  }

  // Everyone sees whether the bay is busy; only the owner also sees their own ended session
  function state(viewerId: string | null = null) {
    const r = current;
    const h = held();
    return {
      reservation: r && (ACTIVE.has(r.status) || r.ownerId === viewerId) ? view(r, viewerId) : null,
      blockedSince: blocker?.since ?? null,
      waiting: viewerId ? waitlist.includes(viewerId) : false,
      priority: h ? { until: h.until, mine: h.userId === viewerId } : null,
      quote: quote(viewerId),
      log,
    };
  }

  // Operators see alerts with plates (until resolved), never drivers' identities
  const operatorState = () => ({
    reservation: current && ACTIVE.has(current.status) ? view(current, null) : null,
    blockedSince: blocker?.since ?? null,
    alerts: alerts.map((a) => ({ ...a })),
    log,
  });

  const bookings = (ownerId: string) => history.filter((r) => r.ownerId === ownerId).map((r) => view(r, ownerId));

  // Raw records for the operator's statistics. Server-only: never send these to a browser as they are.
  const analytics = () => ({ records: [...history, ...(current && ACTIVE.has(current.status) ? [current] : [])], alerts: [...alerts] });

  // "Simulate a week" (demo only): replaces any earlier simulated data instead of piling it up
  function setSimulated(records: Reservation[], extra: Alert[]) {
    const real = history.filter((r) => !r.simulated);
    history.splice(0, history.length, ...[...real, ...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, HISTORY_CAP));
    const realAlerts = alerts.filter((a) => !a.simulated);
    alerts.splice(0, alerts.length, ...[...realAlerts, ...extra].sort((a, b) => b.since - a.since).slice(0, 150));
    note('simulated', `${records.length} simulated bookings added for the past week`);
  }

  return {
    reserve,
    plateEvent,
    checkInManually,
    useOtherPlate,
    extend,
    cancel,
    startCharging,
    finish,
    expire,
    notifyWhenFree,
    leaveWaitlist,
    resolveAlert,
    state,
    operatorState,
    bookings,
    analytics,
    setSimulated,
    setOccupancy,
    quote,
  };
}
