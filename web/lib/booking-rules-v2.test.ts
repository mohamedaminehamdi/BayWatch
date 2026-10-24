import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockStart,
  bookingFee,
  cancelCents,
  cancelPercent,
  cancelSchedule,
  clash,
  classOf,
  dayBlocks,
  demandAt,
  earliestStart,
  idleFee,
  noShowCents,
  reminderTimes,
  slotProblem,
} from './booking-rules.ts';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (s: string) => Date.parse(s); // with an explicit offset: Berlin is +01:00 after 25 Oct 2026

test('classes by power: under 50 kW slow, 50–299 kW fast, 300 kW and up ultra', () => {
  assert.deepEqual([classOf(22), classOf(49), classOf(50), classOf(299), classOf(300), classOf(400)], ['slow', 'slow', 'fast', 'fast', 'ultra', 'ultra']);
});

test('demand from the local time: weekday evenings busy, nights quiet, holidays busy, the demo overrides it all', () => {
  const monday = (hm: string) => at(`2026-10-26T${hm}:00+01:00`);
  assert.equal(demandAt(monday('16:59')), 'normal');
  assert.equal(demandAt(monday('17:00')), 'busy');
  assert.equal(demandAt(monday('18:45')), 'busy');
  assert.equal(demandAt(monday('19:00')), 'normal');
  assert.equal(demandAt(monday('22:00')), 'quiet');
  assert.equal(demandAt(monday('05:45')), 'quiet');
  assert.equal(demandAt(monday('06:00')), 'normal');
  assert.equal(demandAt(at('2026-10-31T18:00:00+01:00')), 'normal', 'Saturday evening');
  const holidays = ['2026-12-25'];
  assert.equal(demandAt(at('2026-12-25T12:00:00+01:00'), { holidays }), 'busy');
  assert.equal(demandAt(at('2026-12-25T23:00:00+01:00'), { holidays }), 'quiet', 'nights stay quiet');
  assert.equal(demandAt(monday('03:00'), { override: 'full' }), 'full');
});

test('fee: €5 × class × demand, rounded down, never more than €10', () => {
  const fee = (c: 'slow' | 'fast' | 'ultra', d: 'quiet' | 'normal' | 'busy' | 'full') => bookingFee(c, d).cents;
  assert.deepEqual([fee('slow', 'normal'), fee('fast', 'normal'), fee('ultra', 'normal')], [250, 500, 750]);
  assert.deepEqual([fee('slow', 'quiet'), fee('fast', 'quiet'), fee('ultra', 'quiet')], [200, 400, 600]);
  assert.deepEqual([fee('slow', 'busy'), fee('fast', 'busy'), fee('ultra', 'busy')], [375, 750, 1000], 'ultra busy would be €11.25');
  assert.deepEqual([fee('slow', 'full'), fee('fast', 'full'), fee('ultra', 'full')], [500, 1000, 1000]);
  assert.deepEqual(bookingFee('ultra', 'quiet'), { cents: 600, demand: 'Quiet', multiplier: 1.2 });
});

test('the grid: quarter-hour starts, the current block for its first 5 min, whole blocks up to the class maximum, 60 days ahead', () => {
  const now = at('2026-10-26T14:07:30+01:00');
  assert.equal(blockStart(now), at('2026-10-26T14:00:00+01:00'));
  assert.equal(earliestStart(at('2026-10-26T14:04:59+01:00')), at('2026-10-26T14:00:00+01:00'));
  assert.equal(earliestStart(at('2026-10-26T14:05:00+01:00')), at('2026-10-26T14:15:00+01:00'));
  const ok = at('2026-10-26T14:15:00+01:00');
  assert.equal(slotProblem('fast', ok, 8, now), null);
  assert.match(slotProblem('fast', ok, 9, now) ?? '', /up to 2 h/);
  assert.equal(slotProblem('slow', ok, 16, now), null);
  assert.match(slotProblem('slow', ok, 17, now) ?? '', /up to 4 h/);
  assert.match(slotProblem('ultra', ok, 5, now) ?? '', /up to 1 h/);
  assert.match(slotProblem('fast', ok, 0, now) ?? '', /at least one/);
  assert.match(slotProblem('fast', ok, 1.5, now) ?? '', /at least one/);
  assert.match(slotProblem('fast', ok + 7 * MIN, 4, now) ?? '', /quarter hour/);
  assert.match(slotProblem('fast', at('2026-10-26T14:00:00+01:00'), 4, now) ?? '', /already started/, 'the current block is over 5 min old');
  const horizon = blockStart(now + 60 * DAY);
  assert.equal(slotProblem('fast', horizon, 4, now), null);
  assert.match(slotProblem('fast', horizon + 15 * MIN, 4, now) ?? '', /60 days/);
});

test('the gap: two sessions on a bay need 10 min between them, so the next start is end + 15 min on the grid', () => {
  const s = at('2026-10-26T14:00:00+01:00');
  assert.equal(clash(s, s + H, s + H, s + 2 * H), true, 'back to back');
  assert.equal(clash(s, s + H, s + H + 10 * MIN, s + 2 * H), false, 'exactly the gap');
  assert.equal(clash(s, s + H, s + H + 15 * MIN, s + 2 * H), false);
  assert.equal(clash(s, s + H, s - H, s - 5 * MIN), true, 'an earlier one ending 5 min before');
});

test('days have 96 blocks, 100 when the clocks go back and 92 when they go forward', () => {
  assert.equal(dayBlocks('2026-10-24').length, 96);
  assert.equal(dayBlocks('2026-10-24')[0], at('2026-10-24T00:00:00+02:00'));
  assert.equal(dayBlocks('2026-10-25').length, 100);
  assert.equal(dayBlocks('2026-03-29').length, 92);
  assert.deepEqual([dayBlocks('2026-02-30'), dayBlocks('tomorrow')], [[], []]);
});

test('cancellation by time before the start, at each tier boundary', () => {
  const start = at('2026-10-30T15:00:00+01:00');
  const bookedAt = start - 10 * DAY;
  const p = (t: number, blocked = false) => cancelPercent({ bookedAt, start, at: t, blocked });
  assert.equal(p(start - 2 * DAY), 0);
  assert.equal(p(start - DAY), 0, '24 h before: still free');
  assert.equal(p(start - DAY + 1), 10);
  assert.equal(p(start - 30 * MIN), 10);
  assert.equal(p(start - 30 * MIN + 1), 50);
  assert.equal(p(start - 5 * MIN), 50);
  assert.equal(p(start - 5 * MIN + 1), 80);
  assert.equal(p(start + 14 * MIN), 80, 'until the arrival deadline');
  assert.equal(p(start - MIN, true), 0, 'free while the bay is blocked');
  const late = start - 3 * MIN; // booked 3 min before the start
  assert.equal(cancelPercent({ bookedAt: late, start, at: late + 2 * MIN }), 0, 'within 2 min of booking');
  assert.equal(cancelPercent({ bookedAt: late, start, at: late + 2 * MIN + 1 }), 80);
  assert.equal(cancelCents(500, { bookedAt, start, at: start - 10 * MIN }), 250);
  assert.equal(cancelCents(375, { bookedAt, start, at: start - H }), 37, '10% of €3.75 (slow, busy), rounded down');
  assert.equal(noShowCents(500), 500, 'a no-show costs the whole fee');
});

test('the cancellation schedule a driver sees before booking', () => {
  const start = at('2026-10-30T15:00:00+01:00');
  const two = cancelSchedule(500, start - 2 * DAY, start);
  assert.deepEqual(
    two.map((s) => [s.from - start, s.percent, s.cents]),
    [
      [-2 * DAY, 0, 0],
      [-DAY + 1, 10, 50],
      [-30 * MIN + 1, 50, 250],
      [-5 * MIN + 1, 80, 400],
    ],
  );
  const soon = cancelSchedule(500, start - 10 * MIN, start);
  assert.deepEqual(
    soon.map((s) => [s.from - start, s.percent]),
    [
      [-10 * MIN, 0],
      [-8 * MIN + 1, 50],
      [-5 * MIN + 1, 80],
    ],
  );
  assert.deepEqual(cancelSchedule(500, start, start).map((s) => s.percent), [0, 80], 'booked as the slot starts');
});

test('overstay: 5 free minutes after the end, then €0.30 a started minute, at most €12', () => {
  const end = at('2026-10-26T15:00:00+01:00');
  assert.equal(idleFee(end, end + 5 * MIN), 0);
  assert.equal(idleFee(end, end + 5 * MIN + 1), 30);
  assert.equal(idleFee(end, end + 7 * MIN), 60);
  assert.equal(idleFee(end, end + 50 * MIN), 1200, '45 min would be €13.50');
  assert.equal(idleFee(end, end - MIN), 0);
});

test('reminders: the six, minus the ones already due at booking, and the day-before one only for bookings a day ahead', () => {
  const start = at('2026-10-30T15:00:00+01:00');
  const end = start + 2 * H;
  const keys = (bookedAt: number) => reminderTimes(bookedAt, start, end).map((r) => r.key);
  assert.deepEqual(keys(start - 2 * DAY), ['day_before', 'live', 'five_before', 'five_left', 'slot_over', 'idle_fee']);
  assert.deepEqual(keys(start - 3 * H), ['live', 'five_before', 'five_left', 'slot_over', 'idle_fee']);
  assert.deepEqual(keys(start - 10 * MIN), ['five_before', 'five_left', 'slot_over', 'idle_fee']);
  assert.deepEqual(keys(start), ['five_left', 'slot_over', 'idle_fee'], 'a walk-up');
  const r = reminderTimes(start - 2 * DAY, start, end);
  assert.deepEqual(
    r.map((x) => x.at - start),
    [-DAY, -30 * MIN, -5 * MIN, 2 * H - 5 * MIN, 2 * H, 2 * H + 5 * MIN],
  );
});
