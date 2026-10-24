// Booking rules: the time grid, what a booking costs, what cancelling, not turning up or staying too long
// costs, and when the driver is reminded. Pure functions (types are the only import), so `node --test` runs
// them as they are. Money is integer euro cents, times are ms timestamps.
// Booking v2 (booking-v2-spec.md) comes first. The v1 "reserve now" rules at the end stay only until the old
// screens and the payments tests have moved to v2; nothing new uses them.

import type { BayClass, CancelStep, DemandLabel, DemandLevel, ReminderKey as BookingReminderKey } from './booking-types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Shared by v1 and v2
export const MAX_RESERVATION_CENTS = 400; // hard cap: a mentor called €5 too much
export const FREE_CANCEL_MS = 2 * MINUTE; // misclicks
export const ARRIVAL_GRACE_MS = 15 * MINUTE;
export const OVERSTAY_CAP_CENTS = 1200; // EnBW's cap per charging session

// Rounded down: half a cent always goes to the driver
const percentOf = (cents: number, percent: number) => Math.floor((cents * percent) / 100);

// ── Booking v2 ────────────────────────────────────────────────────────────────────────────────────

export const TZ = 'Europe/Berlin';
export const BLOCK_MS = 15 * MINUTE; // the grid: starts on :00, :15, :30 and :45, lengths in whole blocks
export const MIN_GAP_MS = 10 * MINUTE; // free time between two sessions of a bay: on the grid, end + 15 min
export const HORIZON_MS = 60 * DAY; // the latest start
export const CURRENT_BLOCK_MS = 5 * MINUTE; // the block under way can still be booked during its first 5 min
export const MAX_UPCOMING = 3; // bookings per driver that haven't started yet, against hoarding
export const LIVE_MS = 30 * MINUTE; // a booking goes live 30 min before its start
export const ARM_MS = 10 * MINUTE; // from start − 10 min the arm must be up, and a car in the bay blocks it
export const WALKUP_CLEAR_MS = 30 * MINUTE; // walk-up needs no booking starting within 30 min + the gap
export const IDLE_GRACE_MS = 5 * MINUTE; // free minutes after the end
export const IDLE_CENTS_PER_MIN = 30;
export const BLOCKED_CREDIT_CENTS = 500; // for the driver whose bay was blocked, once per booking
export const OVERSTAY_OPERATOR_SHARE = 0.5; // of idle fees; the platform keeps the rest
const BASE_FEE_CENTS = 250;

// By the bay's highest power: < 50 kW slow, 50–299 kW fast, 300 kW and up ultra
export const CLASSES: Record<BayClass, { label: string; maxBlocks: number; percent: number }> = {
  slow: { label: 'Slow (AC)', maxBlocks: 16, percent: 50 },
  fast: { label: 'Fast (DC)', maxBlocks: 8, percent: 100 },
  ultra: { label: 'Ultra-fast (DC)', maxBlocks: 4, percent: 150 },
};
export const classOf = (powerKw: number): BayClass => (powerKw >= 300 ? 'ultra' : powerKw >= 50 ? 'fast' : 'slow');

export const DEMAND: Record<DemandLevel, { label: DemandLabel; percent: number }> = {
  quiet: { label: 'Quiet', percent: 80 },
  normal: { label: 'Normal', percent: 100 },
  busy: { label: 'Busy', percent: 150 },
  full: { label: 'Peak', percent: 200 }, // the demo's "Site demand" only
};

const berlin = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});
// A moment in the bays' local time
export function berlinTime(t: number) {
  const p = Object.fromEntries(berlin.formatToParts(t).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

// Weekday evenings (17:00–19:00) are busy and nights (22:00–06:00) quiet, in local time. Holidays
// (YYYY-MM-DD) are busy, except at night. The demo's "Site demand" overrides it all.
export function demandAt(start: number, { override, holidays = [] }: { override?: DemandLevel | null; holidays?: string[] } = {}): DemandLevel {
  if (override) return override;
  const { date, hour, weekday } = berlinTime(start);
  if (hour >= 22 || hour < 6) return 'quiet';
  if (holidays.includes(date)) return 'busy';
  if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 17 && hour < 19) return 'busy';
  return 'normal';
}

// Fixed at booking: €2.50 × class × demand, never more than €4. Integer percentages, so no float drift.
export function bookingFee(cls: BayClass, level: DemandLevel) {
  const percent = (CLASSES[cls].percent * DEMAND[level].percent) / 100;
  return { cents: Math.min(percentOf(BASE_FEE_CENTS, percent), MAX_RESERVATION_CENTS), demand: DEMAND[level].label, multiplier: percent / 100 };
}

// Berlin is always UTC+1 or +2, so its quarter hours are UTC's: the grid is plain arithmetic on timestamps
export const blockStart = (t: number) => t - (((t % BLOCK_MS) + BLOCK_MS) % BLOCK_MS);
export const earliestStart = (now: number) => (now - blockStart(now) < CURRENT_BLOCK_MS ? blockStart(now) : blockStart(now) + BLOCK_MS);

// Why a slot can't be booked, or null. Overlaps and the per-driver limit need the schedule: see schedule.ts.
export function slotProblem(cls: BayClass, start: number, blocks: number, now: number): string | null {
  const { label, maxBlocks } = CLASSES[cls];
  if (!Number.isInteger(blocks) || blocks < 1) return 'Book at least one 15-minute block';
  if (blocks > maxBlocks) return `${label} bays take bookings of up to ${maxBlocks / 4} h`;
  if (!Number.isFinite(start) || start % BLOCK_MS !== 0) return 'Start on the quarter hour: :00, :15, :30 or :45';
  if (start < earliestStart(now)) return 'This slot has already started';
  if (start - now > HORIZON_MS) return `Book at most ${HORIZON_MS / DAY} days ahead`;
  return null;
}

// Two sessions on one bay need MIN_GAP_MS between them
export const clash = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd + MIN_GAP_MS && bStart < aEnd + MIN_GAP_MS;

// The block starts of a local day: 96, or 92 / 100 on the two daylight-saving days. [] for an invalid date.
export function dayBlocks(date: string): number[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || berlinTime(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).date !== date) return [];
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 3 * HOUR; // local midnight is 22:00 or 23:00 UTC the day before
  while (berlinTime(t).date !== date) t += BLOCK_MS;
  const blocks: number[] = [];
  for (; berlinTime(t).date === date; t += BLOCK_MS) blocks.push(t);
  return blocks;
}

// Cancelling, measured from the start: free a day or more ahead, then 10%, 50% from 30 min before and 80% from
// 5 min before until the arrival deadline. Free in the first 2 min after booking, and while the bay is blocked.
const CANCEL_BEFORE_START = [
  { before: DAY, percent: 0 },
  { before: 30 * MINUTE, percent: 10 },
  { before: 5 * MINUTE, percent: 50 },
];
export const LATE_CANCEL_PERCENT = 80;
type CancelWhen = { bookedAt: number; start: number; at: number; blocked?: boolean };
export function cancelPercent({ bookedAt, start, at, blocked = false }: CancelWhen) {
  if (blocked || at - bookedAt <= FREE_CANCEL_MS) return 0;
  const before = start - at;
  return CANCEL_BEFORE_START.find((t) => before >= t.before)?.percent ?? LATE_CANCEL_PERCENT;
}
export const cancelCents = (feeCents: number, when: CancelWhen) => percentOf(feeCents, cancelPercent(when));

// What cancelling costs from each moment on, for a booking made at `bookedAt`
export function cancelSchedule(feeCents: number, bookedAt: number, start: number): CancelStep[] {
  const moments = [bookedAt, bookedAt + FREE_CANCEL_MS + 1, ...CANCEL_BEFORE_START.map((t) => start - t.before + 1)]
    .filter((t) => t >= bookedAt)
    .sort((a, b) => a - b);
  const steps: CancelStep[] = [];
  for (const from of moments) {
    const percent = cancelPercent({ bookedAt, start, at: from });
    if (steps.at(-1)?.percent !== percent) steps.push({ from, percent, cents: percentOf(feeCents, percent) });
  }
  return steps;
}

// Not turning up costs the whole fee
export const noShowCents = (feeCents: number) => feeCents;

// After the 5 free minutes, €0.30 per started minute, capped like EnBW's blocking fee
export const idleMinutes = (end: number, leftAt: number) => Math.max(0, Math.ceil((leftAt - end - IDLE_GRACE_MS) / MINUTE));
export const idleFee = (end: number, leftAt: number) => Math.min(idleMinutes(end, leftAt) * IDLE_CENTS_PER_MIN, OVERSTAY_CAP_CENTS);

// The six reminders. Ones already due when the driver books are skipped (booked 10 min ahead: no "live"
// reminder), and the day-before one needs a booking made more than a day ahead. The sender re-checks the
// booking at send time: start reminders only before the car arrives, end reminders only once it has.
export function reminderTimes(bookedAt: number, start: number, end: number) {
  const all: { key: BookingReminderKey; at: number }[] = [
    ...(start - bookedAt > DAY ? [{ key: 'day_before' as const, at: start - DAY }] : []),
    { key: 'live', at: start - LIVE_MS },
    { key: 'five_before', at: start - 5 * MINUTE },
    { key: 'five_left', at: end - 5 * MINUTE },
    { key: 'slot_over', at: end },
    { key: 'idle_fee', at: end + IDLE_GRACE_MS },
  ];
  return all.filter((r) => r.at > bookedAt);
}

// ── v1, "reserve now" (deprecated) ────────────────────────────────────────────────────────────────

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

export const NO_SHOW_PERCENT = 50; // of the reservation fee
// Cancelling costs a share of the no-show fee: the earlier, the likelier someone else books the bay.
// A day or more ahead it's free: a no-show clause needs a fair free window (doc, open question 2).
export const CANCEL_TIERS = [
  { before: DAY, percent: 0 },
  { before: 2 * HOUR, percent: 30 },
  { before: 10 * MINUTE, percent: 40 },
];
export const LAST_MINUTE_CANCEL_PERCENT = 60; // under 10 min before the start, or after it

export const OVERSTAY_GRACE_MS = 15 * MINUTE;

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
