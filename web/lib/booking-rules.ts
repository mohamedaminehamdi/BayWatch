// Booking rules for reserved slots: what a booking costs, what cancelling or not turning up costs,
// when the driver is reminded, and when the bay goes back to everyone else.
// Pure functions without project imports, so `node --test` runs them as they are.
// Money is integer euro cents, times are ms timestamps. Sources for every number: docs/reservation-model.md.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ReservationType = 'fast' | 'slow';

// The baseline pays for the bay standing empty through the 15-min arrival grace, at the idle rates
// operators already charge: AC 15 min × €0.10 (EnBW, EWE Go) = €1.50, today's price; DC 15 min ×
// €0.15–0.246 (Aral, Allego) = €2.25–3.69, so €2.50, close to EVgo's $3. Overstay uses the same rates.
export const TYPES = {
  fast: { label: 'Fast (DC)', maxMs: 2 * HOUR, baseCents: 250, overstayCentsPerMin: 25 },
  slow: { label: 'Slow (AC)', maxMs: 4 * HOUR, baseCents: 150, overstayCentsPerMin: 10 },
};

// Demand is the forecast share of the site's bays in use during the slot. Quiet slots get cheaper to
// pull bookings into idle hours; at peak the price doubles, as Tesla's idle fee does at a full site.
const NORMAL = { label: 'Normal', from: 0.3, percent: 100 };
export const DEMAND_TIERS = [
  { label: 'Peak', from: 0.9, percent: 200 },
  { label: 'Busy', from: 0.7, percent: 150 },
  NORMAL,
  { label: 'Quiet', from: 0, percent: 80 },
];
export const MAX_RESERVATION_CENTS = 400; // hard cap: a mentor called €5 too much

export const NO_SHOW_PERCENT = 50; // of the reservation fee
export const FREE_CANCEL_MS = 2 * MINUTE; // misclicks, as in pricing.ts
// Cancelling costs a share of the no-show fee: the earlier, the likelier someone else books the bay.
// A day or more ahead it's free: a no-show clause needs a fair free window (doc, open question 2).
export const CANCEL_TIERS = [
  { before: DAY, percent: 0 },
  { before: 2 * HOUR, percent: 30 },
  { before: 10 * MINUTE, percent: 40 },
];
export const LAST_MINUTE_CANCEL_PERCENT = 60; // under 10 min before the start, or after it

export const ARRIVAL_GRACE_MS = 15 * MINUTE;
export const OVERSTAY_GRACE_MS = 15 * MINUTE;
export const OVERSTAY_CAP_CENTS = 1200; // EnBW's cap per charging session

export const NO_SHOW_LIMIT = 3; // within the last RELIABILITY_LOOKBACK bookings
export const RELIABILITY_LOOKBACK = 10;
export const OUTCOME_RETENTION_MS = 90 * DAY;

export type ReminderKey = 'starts_in_1d' | 'starts_in_2h' | 'starts_in_15m' | 'ends_in_1h' | 'ends_in_15m';
export type Reminder = { at: number; key: ReminderKey };
const BEFORE_START: { lead: number; key: ReminderKey }[] = [
  { lead: DAY, key: 'starts_in_1d' },
  { lead: 2 * HOUR, key: 'starts_in_2h' },
  { lead: 15 * MINUTE, key: 'starts_in_15m' },
];
const BEFORE_END: { lead: number; key: ReminderKey }[] = [
  { lead: HOUR, key: 'ends_in_1h' },
  { lead: 15 * MINUTE, key: 'ends_in_15m' },
];

// Rounded down: half a cent always goes to the driver
const percentOf = (cents: number, percent: number) => Math.floor((cents * percent) / 100);

// Checks a requested slot. The type comes straight from the client, so look it up safely.
export function slotError(type: string, start: number, end: number, now: number): string | null {
  if (!Object.hasOwn(TYPES, type)) return 'Unknown reservation type';
  const { label, maxMs } = TYPES[type as ReservationType];
  if (!(end > start)) return 'The slot must end after it starts';
  if (start < now) return 'This slot has already started'; // "now" bookings: let the server set start
  if (end - start > maxMs) return `${label} slots last at most ${maxMs / HOUR} h`;
  return null;
}

// Fixed when the driver books, and shown before they confirm.
// Without occupancy data (a new site, today's single test bay) the slot is priced as normal.
export function reservationFee(type: ReservationType, occupancy?: number) {
  const tier = DEMAND_TIERS.find((t) => (occupancy ?? NaN) >= t.from) ?? NORMAL;
  const cents = Math.min(percentOf(TYPES[type].baseCents, tier.percent), MAX_RESERVATION_CENTS);
  return { cents, demand: tier.label, multiplier: tier.percent / 100 };
}

// Half the reservation fee, so always less than it. A driver who had to prepay gets nothing back.
export const noShowFee = (feeCents: number, prepaid = false) => (prepaid ? feeCents : percentOf(feeCents, NO_SHOW_PERCENT));

// A share of the normal no-show fee, for prepaid drivers too: cancelling must always beat not turning up,
// or a late canceller would rather leave the bay frozen until the grace runs out.
export function cancellationFee(feeCents: number, { bookedAt, start, cancelledAt }: { bookedAt: number; start: number; cancelledAt: number }) {
  if (cancelledAt - bookedAt <= FREE_CANCEL_MS) return 0;
  const lead = start - cancelledAt;
  const percent = CANCEL_TIERS.find((t) => lead >= t.before)?.percent ?? LAST_MINUTE_CANCEL_PERCENT;
  return percentOf(noShowFee(feeCents), percent);
}

// Arriving up to 15 min late keeps the booking; the slot still ends on time
export const arrivalDeadline = (start: number) => start + ARRIVAL_GRACE_MS;

// Takes the deadline, not the start: reservation.ts moves it while another car blocks the bay
export const isNoShow = (deadline: number, now: number) => now > deadline;

// Per started minute after the grace, at the type's idle rate, capped like EnBW's blocking fee
export function overstayFee(type: ReservationType, end: number, leftAt: number) {
  const over = leftAt - end - OVERSTAY_GRACE_MS;
  if (!(over > 0)) return 0;
  return Math.min(Math.ceil(over / MINUTE) * TYPES[type].overstayCentsPerMin, OVERSTAY_CAP_CENTS);
}

// Takes the driver's own past bookings, nothing else (e.g. reservation.ts history: status + endedAt).
// Only bookings that reached their start count, so booking and cancelling can't wash out no-shows.
// Outcomes past the retention window are ignored, and should be deleted by then anyway.
export type PastBooking = { status: string; endedAt?: number };

export function assessReliability(past: PastBooking[], now: number) {
  const recent = past
    .filter((b) => (b.status === 'completed' || b.status === 'no_show') && now - (b.endedAt ?? 0) <= OUTCOME_RETENTION_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, RELIABILITY_LOOKBACK);
  const missed = recent.filter((b) => b.status === 'no_show').length;
  const record = `you missed ${missed} of your last ${recent.length} bookings`;
  if (missed >= NO_SHOW_LIMIT) {
    return {
      prepayRequired: true,
      warning:
        `${record[0].toUpperCase()}${record.slice(1)}, so you now pay the reservation fee up front. If you don’t arrive, it isn’t refunded. ` +
        `This ends once fewer than ${NO_SHOW_LIMIT} of your last ${RELIABILITY_LOOKBACK} bookings are no-shows; ` +
        `no-shows drop off after ${OUTCOME_RETENTION_MS / DAY} days.`,
    };
  }
  if (missed === NO_SHOW_LIMIT - 1) {
    return {
      prepayRequired: false,
      warning: `Careful: ${record}. One more no-show and you’ll pay the reservation fee up front, with no refund if you don’t arrive.`,
    };
  }
  return { prepayRequired: false, warning: null };
}

// Reminders already due when the driver books are skipped: booked 3 h ahead, there's no 1-day reminder;
// booked 10 min ahead, no start reminders at all (the confirmation shows the arrival deadline instead).
// End reminders only fall inside the slot. The sender re-checks the booking at send time: start
// reminders only while it's still reserved, end reminders only once the car has arrived.
export function notificationSchedule(bookedAt: number, start: number, end: number): Reminder[] {
  const beforeStart = BEFORE_START.map(({ lead, key }) => ({ at: start - lead, key })).filter((r) => r.at > bookedAt);
  const beforeEnd = BEFORE_END.map(({ lead, key }) => ({ at: end - lead, key })).filter((r) => r.at > Math.max(bookedAt, start));
  return [...beforeStart, ...beforeEnd];
}
