import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrivalDeadline,
  assessReliability,
  cancellationFee,
  isNoShow,
  MAX_RESERVATION_CENTS,
  noShowFee,
  notificationSchedule,
  overstayFee,
  reservationFee,
  slotError,
} from './booking-rules.ts';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const start = Date.parse('2026-10-30T14:00:00+01:00');

test('reservation fee: baseline by type, scaled by demand, never above the cap', () => {
  assert.deepEqual(reservationFee('fast'), { cents: 250, demand: 'Normal', multiplier: 1 }, 'no occupancy data: normal');
  assert.equal(reservationFee('fast', NaN).cents, 250);
  assert.equal(reservationFee('slow', 0.5).cents, 150);
  assert.equal(reservationFee('fast', 0.1).cents, 200, 'quiet: 0.8x');
  assert.equal(reservationFee('slow', 0.29).cents, 120);
  assert.equal(reservationFee('slow', 0.3).cents, 150, 'a tier starts at its lower bound');
  assert.equal(reservationFee('fast', 0.7).cents, 375, 'busy: 1.5x');
  assert.equal(reservationFee('slow', 0.9).cents, 300, 'peak: 2x');
  assert.equal(reservationFee('fast', 0.95).cents, MAX_RESERVATION_CENTS, 'fast at peak would be €5.00, capped at €4.00');
  assert.equal(reservationFee('fast', 7).cents, MAX_RESERVATION_CENTS);
});

test('no-show fee: half the reservation fee, always less than it; prepaid drivers get nothing back', () => {
  assert.equal(noShowFee(250), 125);
  assert.equal(noShowFee(375), 187, 'rounded down, in the driver’s favour');
  for (const fee of [1, 120, 375, 400]) assert.ok(noShowFee(fee) < fee);
  assert.equal(noShowFee(250, true), 250);
});

test('cancellation fee: free a day ahead, cheaper the earlier, always less than a no-show, free right after booking', () => {
  const fee = 250; // no-show fee 125
  const cancel = (lead: number, bookedAt = start - 3 * DAY) => cancellationFee(fee, { bookedAt, start, cancelledAt: start - lead });
  assert.equal(cancel(2 * DAY), 0, '≥ 24 h ahead: free');
  assert.equal(cancel(DAY), 0, 'exactly 24 h still counts as a day ahead');
  assert.equal(cancel(DAY - 1), 37, 'under 24 h: 30%');
  assert.equal(cancel(2 * H), 37);
  assert.equal(cancel(2 * H - 1), 50, 'under 2 h: 40%');
  assert.equal(cancel(10 * MIN), 50, 'exactly 10 min is not last-minute yet');
  assert.equal(cancel(10 * MIN - 1), 75, 'under 10 min: 60%');
  assert.equal(cancel(-5 * MIN), 75, 'after the start, within the grace');
  for (const lead of [2 * DAY, 3 * H, 20 * MIN, 0, -10 * MIN]) assert.ok(cancel(lead) < noShowFee(fee));
  assert.equal(cancel(5 * MIN, start - 7 * MIN), 0, 'within 2 min of booking: a misclick, free');
  assert.equal(cancel(5 * MIN, start - 7 * MIN - 1), 75);
});

test('arrival: up to 15 min late keeps the booking, a moment later it is a no-show', () => {
  const deadline = arrivalDeadline(start);
  assert.equal(deadline, start + 15 * MIN);
  assert.equal(isNoShow(deadline, start), false);
  assert.equal(isNoShow(deadline, deadline), false, 'exactly 15 min late is still on time');
  assert.equal(isNoShow(deadline, deadline + 1), true);
});

test('overstay: 15 min grace after the end, then the idle rate per started minute, capped', () => {
  const end = start + 2 * H;
  assert.equal(overstayFee('slow', end, end - 10 * MIN), 0, 'left before the end');
  assert.equal(overstayFee('slow', end, end + 15 * MIN), 0, 'grace edge');
  assert.equal(overstayFee('slow', end, end + 15 * MIN + 1), 10, 'first started minute');
  assert.equal(overstayFee('fast', end, end + 15 * MIN + 1), 25);
  assert.equal(overstayFee('slow', end, end + 40 * MIN), 250, '25 min × €0.10');
  assert.equal(overstayFee('fast', end, end + 40 * MIN), 625, '25 min × €0.25');
  assert.equal(overstayFee('fast', end, end + 3 * H), 1200, 'capped at €12');
});

test('reliability: 2 no-shows in the last 10 bookings warn, 3 mean prepaying', () => {
  const now = start;
  const ago = (days: number) => now - days * DAY;
  const history = (...statuses: string[]) => statuses.map((status, i) => ({ status, endedAt: ago(i + 1) })); // newest first
  const completed = (n: number) => Array<string>(n).fill('completed');

  assert.deepEqual(assessReliability([], now), { prepayRequired: false, warning: null });
  assert.deepEqual(assessReliability(history('no_show', 'completed'), now), { prepayRequired: false, warning: null });

  const two = assessReliability(history('no_show', 'completed', 'no_show'), now);
  assert.equal(two.prepayRequired, false);
  assert.match(two.warning ?? '', /^Careful: you missed 2 of your last 3 bookings\. One more no-show/);

  const three = assessReliability(history('no_show', 'no_show', 'completed', 'no_show'), now);
  assert.equal(three.prepayRequired, true, 'threshold reached');
  assert.match(three.warning ?? '', /^You missed 3 of your last 4 bookings, so you now pay the reservation fee up front/);

  // back to normal by showing up: 8 bookings after 3 no-shows in a row push the oldest out of the last 10
  assert.equal(assessReliability(history(...completed(7), 'no_show', 'no_show', 'no_show'), now).prepayRequired, true);
  const back = assessReliability(history(...completed(8), 'no_show', 'no_show', 'no_show'), now);
  assert.equal(back.prepayRequired, false);
  assert.match(back.warning ?? '', /missed 2 of your last 10/);

  // cancelling doesn't push no-shows out of the window
  assert.equal(assessReliability(history(...Array<string>(12).fill('cancelled'), 'no_show', 'no_show', 'no_show'), now).prepayRequired, true);

  // no-shows older than 90 days stop counting; the input order doesn't matter
  const recent = [{ status: 'no_show', endedAt: ago(1) }, { status: 'no_show', endedAt: ago(2) }];
  assert.equal(assessReliability([{ status: 'no_show', endedAt: ago(91) }, ...recent], now).prepayRequired, false);
  assert.equal(assessReliability([{ status: 'no_show', endedAt: ago(90) }, ...recent], now).prepayRequired, true, 'exactly 90 days still counts');
});

test('notifications: 1 day, 2 h and 15 min before the start, 1 h and 15 min before the end, nothing in the past', () => {
  const end = start + 2 * H;
  const keys = (bookedAt: number, slotEnd = end) => notificationSchedule(bookedAt, start, slotEnd).map((n) => n.key);
  assert.deepEqual(notificationSchedule(start - 3 * DAY, start, end), [
    { at: start - DAY, key: 'starts_in_1d' },
    { at: start - 2 * H, key: 'starts_in_2h' },
    { at: start - 15 * MIN, key: 'starts_in_15m' },
    { at: end - H, key: 'ends_in_1h' },
    { at: end - 15 * MIN, key: 'ends_in_15m' },
  ]);
  assert.deepEqual(keys(start - 3 * H), ['starts_in_2h', 'starts_in_15m', 'ends_in_1h', 'ends_in_15m'], 'booked 3 h ahead');
  assert.deepEqual(keys(start - 2 * H), ['starts_in_15m', 'ends_in_1h', 'ends_in_15m'], 'a reminder due at booking time is skipped');
  assert.deepEqual(keys(start - 10 * MIN), ['ends_in_1h', 'ends_in_15m'], 'short notice: no start reminders');
  assert.deepEqual(keys(start), ['ends_in_1h', 'ends_in_15m'], 'booked for right now');
  assert.deepEqual(keys(start - 3 * DAY, start + 45 * MIN), ['starts_in_1d', 'starts_in_2h', 'starts_in_15m', 'ends_in_15m'], '45-min slot: no 1-h end reminder');
});

test('slots: fast up to 2 h, slow up to 4 h, not already started, known type', () => {
  const now = start - H;
  assert.equal(slotError('fast', start, start + 2 * H, now), null);
  assert.match(slotError('fast', start, start + 2 * H + 1, now) ?? '', /at most 2 h/);
  assert.equal(slotError('slow', start, start + 4 * H, now), null);
  assert.match(slotError('slow', start, start + 4 * H + 1, now) ?? '', /at most 4 h/);
  assert.ok(slotError('fast', start, start, now), 'empty slot');
  assert.ok(slotError('fast', start, start + H, start + 1), 'already started');
  assert.equal(slotError('fast', start, start + H, start), null, 'starting right now is fine');
  assert.ok(slotError('turbo', start, start + H, now));
  assert.ok(slotError('constructor', start, start + H, now), 'prototype keys are not types');
});
