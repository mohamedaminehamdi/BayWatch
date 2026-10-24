import test from 'node:test';
import assert from 'node:assert/strict';
import type { BayInfo } from './bays.ts';
import type { Wallet } from './booking-types.ts';
import { createSchedule, type Hardware } from './schedule.ts';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const at = (hm: string, day = '2026-10-26') => Date.parse(`${day}T${hm}:00+01:00`); // a Monday, Berlin winter time
const ANNA = 'user_anna';
const BEN = 'user_ben';
const HERE = { lat: 52.52, lng: 13.405 };
const FAR = { lat: 52.53, lng: 13.405 };

const BW1: BayInfo = { id: 'bw-1', name: 'Baywatch Bay 1', ...HERE, address: 'Venue', points: [{ type: 'CCS', power: 200, count: 1 }], powerKw: 200, class: 'fast', real: true, guard: 'hardware', lockId: 'lock-0002' };
const BW3: BayInfo = { ...BW1, id: 'bw-3', name: 'Baywatch Bay 3', lng: 13.40509, guard: 'simulated', lockId: undefined };
const GE: BayInfo = { id: 'ge-3080', name: 'Parkhaus', lat: 52.521, lng: 13.406, address: 'Berlin', points: [{ type: 'Typ2', power: 22, count: 2 }], powerKw: 22, class: 'slow', real: false, guard: 'simulated' };

// A schedule on a fake clock, with a fake lock (lock-0002) that records every call
function setup(wallets: Record<string, Partial<Wallet>> = {}) {
  let t = at('10:02');
  const calls: string[] = [];
  const state = { carOverArm: false, presence: 'vacant' as 'vacant' | 'occupied' };
  const hw: Hardware = {
    raise: async (lock, plates) => {
      calls.push(`raise ${lock} [${plates.join(',')}]`);
      if (state.carOverArm) throw new Error('A car is over the arm, so it was not raised');
    },
    lower: async (lock) => void calls.push(`lower ${lock}`),
    setPlates: async (lock, plates) => void calls.push(`plates ${lock} [${plates.join(',')}]`),
    status: async () => ({ state: 'blocked', mock: false, online: true, carPresence: state.presence }),
  };
  const saved: Record<string, Wallet> = {};
  const store = {
    load: async (id: string) => ({ creditCents: 0, firstFree: false, ...wallets[id] }),
    save: async (id: string, w: Wallet) => void (saved[id] = { ...w }),
  };
  const alerts: unknown[] = [];
  const s = createSchedule({ bays: [BW1, BW3], hw, wallets: store, now: () => t, onAlert: (a) => alerts.push(a), nearby: async () => [GE, BW1] });
  s.knowBay(GE);
  const book = (who: string, bayId: string, start: number, blocks = 4, plate = 'MAB1234') =>
    s.reserve(who, { bayId, start, blocks, plate, vehicleLabel: 'Blue Zoe' });
  const advance = async (ms: number) => {
    t += ms;
    await s.tick();
  };
  return { s, calls, saved, alerts, state, book, advance, now: () => t, setNow: (x: number) => (t = x) };
}

test('booking on the grid: the fee by class and demand, the gap, the 3-booking limit and a price check', async () => {
  const { s, book } = setup();
  const v = await book(ANNA, 'bw-1', at('11:00'));
  assert.deepEqual([v.status, v.feeCents, v.demand, v.end - v.start, v.blocks, v.arriveBy], ['upcoming', 250, 'Normal', H, 4, at('11:15')]);
  assert.deepEqual(v.charges.map((c) => [c.kind, c.cents]), [['reservation', 250]]);
  await assert.rejects(book(BEN, 'bw-1', at('11:30')), { status: 409, message: /overlaps/ });
  await assert.rejects(book(BEN, 'bw-1', at('12:00')), { status: 409 }, 'right after it: no 10-min gap');
  assert.equal((await book(BEN, 'bw-1', at('12:15'))).status, 'upcoming');
  await assert.rejects(book(BEN, 'bw-1', at('13:07')), { status: 400, message: /quarter hour/ });
  await assert.rejects(book(BEN, 'bw-1', at('14:00'), 9), { status: 400, message: /up to 2 h/ });
  await assert.rejects(book(BEN, 'bw-1', at('09:45')), { status: 400, message: /already started/ });
  await book(BEN, 'bw-3', at('15:00'));
  await book(BEN, 'ge-3080', at('15:00'), 16);
  await assert.rejects(book(BEN, 'bw-3', at('18:00')), { status: 409, message: /up to 3 upcoming/ });
  await assert.rejects(s.reserve(ANNA, { bayId: 'bw-3', start: at('17:00'), blocks: 4, plate: 'MAB1234', vehicleLabel: 'Car', expectedCents: 250 }), {
    status: 409,
    message: 'The price is now €3.75. Check it and book again.',
  });
  assert.equal((await s.reserve(ANNA, { bayId: 'bw-3', start: at('17:00'), blocks: 4, plate: 'MAB1234', vehicleLabel: 'Car', expectedCents: 375 })).demand, 'Busy');
  s.setDemand('full');
  assert.equal((await s.quoteSlot(null, 'bw-1', at('20:00'), 4)).cents, 400, 'peak, capped at €4');
  assert.equal((await s.quoteSlot(null, 'ge-3080', at('20:00'), 4)).cents, 250, 'slow at peak');
});

test('credit: a free first reservation, then wallet credit, on the receipt and saved to the wallet', async () => {
  const { s, book, saved } = setup({ [ANNA]: { firstFree: true, creditCents: 100 } });
  const q = await s.quoteSlot(ANNA, 'bw-1', at('11:00'), 4);
  assert.deepEqual([q.cents, q.creditAppliedCents, q.payCents, q.noShowCents, q.valid], [250, 250, 0, 250, true]);
  const first = await book(ANNA, 'bw-1', at('11:00'));
  assert.deepEqual(first.charges.map((c) => [c.label, c.cents]), [['Reservation · Fast (DC) · normal demand', 250], ['Free first reservation', -250]]);
  assert.equal(first.totalCents, 0);
  assert.deepEqual(saved[ANNA], { creditCents: 100, firstFree: false });
  const second = await book(ANNA, 'bw-3', at('11:00'));
  assert.deepEqual([second.creditUsedCents, second.totalCents], [100, 150]);
  assert.deepEqual(saved[ANNA], { creditCents: 0, firstFree: false });
  assert.deepEqual((await s.bookingsOf(ANNA)).upcoming.map((b) => b.bayId), ['bw-1', 'bw-3']);
  const bad = await s.quoteSlot(ANNA, 'bw-1', at('11:30'), 4);
  assert.deepEqual([bad.valid, /overlaps/.test(bad.reason ?? '')], [false, true]);
});

test('availability: free, booked, mine, gap and past blocks, viewer by viewer', async () => {
  const { s, book } = setup();
  await book(BEN, 'bw-1', at('11:00'));
  const state = (who: string | null, hm: string) => s.availability(who, 'bw-1', '2026-10-26').blocks.find((b) => b.start === at(hm))?.state;
  assert.equal(s.availability(null, 'bw-1', '2026-10-26').blocks.length, 96);
  assert.deepEqual(
    ['09:45', '10:00', '10:45', '11:00', '11:45', '12:00', '12:15'].map((hm) => state(ANNA, hm)),
    ['past', 'free', 'gap', 'booked', 'booked', 'gap', 'free'],
  );
  assert.equal(state(BEN, '11:15'), 'mine');
  assert.equal(s.availability(null, 'bw-1', '2026-10-25').blocks.length, 100, 'the clocks went back');
  assert.throws(() => s.availability(null, 'bw-1', '26.10.2026'), { status: 400 });
});

test('a booking goes live 30 min ahead; the arm rises 10 min ahead, the booked plate lowers it, and it rises again when the car has left', async () => {
  const { s, book, advance, calls, setNow } = setup();
  const { id } = await book(ANNA, 'bw-1', at('11:00'));
  assert.deepEqual(calls, [], 'nothing moves at booking time for a later slot');
  setNow(at('10:29'));
  await advance(MIN);
  assert.equal(s.get(ANNA, id).status, 'live');
  assert.deepEqual(calls, []);
  setNow(at('10:49'));
  await advance(MIN);
  assert.deepEqual(calls, ['raise lock-0002 [MAB1234]'], 'start − 10 min');
  assert.deepEqual(await s.plateEvent('bw-1', 'BXY99'), { matched: false }, 'another car in front of the raised arm');
  assert.deepEqual(await s.plateEvent('bw-1', 'M-AB 1234'), { matched: true, matchedBy: 'exact' });
  assert.deepEqual(calls, ['raise lock-0002 [MAB1234]', 'lower lock-0002']);
  assert.equal(s.startCharging(ANNA, id).status, 'charging');
  setNow(at('12:02'));
  assert.equal(s.finish(ANNA, id).totalCents, 250, 'inside the 5 free minutes');
  assert.equal(calls.length, 2, 'finishing doesn’t raise the arm under the car');
  await s.vacated('bw-1');
  assert.deepEqual(calls.at(-1), 'raise lock-0002 []', 'guarded again once the car has gone');
  assert.equal(s.get(ANNA, id).plateHint, undefined, 'the plate is erased');
});

test('a slot starting now raises the arm at booking time; a car over the arm undoes the booking with its reason', async () => {
  const { s, book, calls, state, saved } = setup({ [ANNA]: { firstFree: true } });
  state.carOverArm = true;
  await assert.rejects(book(ANNA, 'bw-1', at('10:00')), {
    status: 409,
    message: 'The bay could not be reserved: A car is over the arm, so it was not raised',
  });
  assert.deepEqual((await s.bookingsOf(ANNA)).upcoming, []);
  assert.equal((await s.wallet(ANNA)).firstFree, true, 'the free first reservation is still there');
  assert.equal(saved[ANNA]?.firstFree, true);
  state.carOverArm = false;
  const v = await book(ANNA, 'bw-1', at('10:00'));
  assert.equal(v.status, 'live');
  assert.deepEqual(calls, ['raise lock-0002 [MAB1234]', 'raise lock-0002 [MAB1234]']);
});

test('no-show: after the 15-min arrival grace the whole fee is kept', async () => {
  const { s, book, advance, setNow, calls } = setup();
  const { id } = await book(ANNA, 'bw-1', at('11:00'));
  setNow(at('11:15'));
  await advance(0);
  assert.equal(s.get(ANNA, id).status, 'live', 'exactly on the deadline');
  await advance(1);
  const v = s.get(ANNA, id);
  assert.deepEqual([v.status, v.totalCents, v.cancelNowCents], ['no_show', 250, null]);
  assert.equal(calls.at(-1), 'plates lock-0002 []', 'the camera forgets the plate');
});

test('cancelling: free within 2 min or a day ahead, then 10%, 50% and 80% of the fee; credit pays first and comes back first', async () => {
  const { s, book, setNow } = setup();
  const early = await book(ANNA, 'bw-1', at('11:00'));
  setNow(at('10:03'));
  assert.deepEqual((await s.cancel(ANNA, early.id)).charges.map((c) => [c.label, c.cents]), [
    ['Reservation · Fast (DC) · normal demand', 250],
    ['Refund: cancelled within 2 min of booking', -250],
  ]);
  setNow(at('10:02'));
  const ahead = await book(ANNA, 'bw-1', at('11:00', '2026-10-28'));
  setNow(at('11:00', '2026-10-27'));
  assert.deepEqual([(await s.cancel(ANNA, ahead.id)).totalCents], [0], '24 h before: free');
  setNow(at('10:02'));
  const mid = await book(ANNA, 'bw-1', at('11:00'));
  setNow(at('10:40'));
  assert.equal(s.get(ANNA, mid.id).cancelNowCents, 125);
  assert.deepEqual((await s.cancel(ANNA, mid.id)).charges.at(-1), { kind: 'released', label: 'Cancelled: returned, less the €1.25 cancellation fee', cents: -125, at: at('10:40') });
  setNow(at('10:02'));
  const late = await book(ANNA, 'bw-1', at('11:00'));
  setNow(at('10:56'));
  assert.equal((await s.cancel(ANNA, late.id)).totalCents, 200, '80% from 5 min before');

  const credit = setup({ [BEN]: { creditCents: 250 } });
  const b = await credit.book(BEN, 'bw-1', at('11:00'));
  credit.setNow(at('10:40'));
  const c = await credit.s.cancel(BEN, b.id);
  assert.deepEqual(c.charges.map((x) => [x.kind, x.cents]), [['reservation', 250], ['credit', -250], ['released', -125], ['credit', 125]]);
  assert.deepEqual([c.totalCents, c.creditUsedCents, (await credit.s.wallet(BEN)).creditCents], [0, 125, 125], 'the fee came out of the credit');

  const free = setup({ [BEN]: { firstFree: true } });
  const f = await free.book(BEN, 'bw-1', at('11:00'));
  free.setNow(at('10:03'));
  await free.s.cancel(BEN, f.id);
  assert.equal((await free.s.wallet(BEN)).firstFree, true, 'cancelled for free: the free first reservation comes back');
  const g = await free.book(BEN, 'bw-1', at('11:00'));
  free.setNow(at('10:40'));
  assert.equal((await free.s.cancel(BEN, g.id)).totalCents, 0);
  assert.equal((await free.s.wallet(BEN)).firstFree, false, 'a cancellation fee uses it up');
  await assert.rejects(free.s.cancel(BEN, g.id), { status: 409 });
  await assert.rejects(free.s.cancel(ANNA, g.id), { status: 404 }, 'someone else’s booking doesn’t exist for you');
});

test('a car in a simulated bay from start − 10 min blocks the booking: €5 credit once, an alert, alternatives, a free cancel, and the deadline waits', async () => {
  const { s, book, advance, setNow, alerts, saved } = setup();
  const { id } = await book(ANNA, 'bw-3', at('11:00'));
  await s.setOccupied('bw-3', true);
  assert.equal(s.get(ANNA, id).blockedSince, undefined, 'not yet: more than 10 min to the start');
  setNow(at('10:50'));
  await advance(0);
  let v = s.get(ANNA, id);
  assert.equal(v.blockedSince, at('10:50'));
  assert.deepEqual([v.creditGrantedCents, v.cancelNowCents, alerts.length], [500, 0, 1]);
  assert.deepEqual(v.reroute?.alternatives.map((b) => [b.id, b.status]), [['bw-1', 'free'], ['ge-3080', 'free']], 'nearest first');
  await new Promise((r) => setImmediate(r)); // the wallet is saved in the background
  assert.deepEqual(saved[ANNA], { creditCents: 500, firstFree: false });
  await advance(30 * MIN);
  assert.equal(s.get(ANNA, id).status, 'live', 'no no-show while blocked');
  await s.setOccupied('bw-3', false);
  v = s.get(ANNA, id);
  assert.deepEqual([v.blockedSince, v.arriveBy, v.reroute], [undefined, at('11:15') + 30 * MIN, undefined]);
  await s.setOccupied('bw-3', true);
  await advance(0);
  assert.equal(s.get(ANNA, id).creditGrantedCents, 500, 'the credit is granted once per booking');
  assert.equal(alerts.length, 2);
});

test('a real bay: a car over the arm at start − 10 min blocks the booking; the sensor reading vacant clears it and the arm rises', async () => {
  const { s, book, advance, setNow, state, calls, alerts } = setup();
  const { id } = await book(ANNA, 'bw-1', at('11:00'));
  state.carOverArm = true;
  state.presence = 'occupied';
  setNow(at('10:50'));
  await advance(0);
  assert.equal(s.get(ANNA, id).blockedSince, at('10:50'));
  assert.equal(alerts.length, 1);
  assert.equal(s.bayView(BW1).status, 'occupied');
  state.carOverArm = false;
  state.presence = 'vacant';
  await advance(5_000);
  assert.equal(s.get(ANNA, id).blockedSince, undefined, 'a vacant sensor clears the bay');
  await advance(30_000);
  assert.deepEqual(calls, ['raise lock-0002 [MAB1234]', 'raise lock-0002 [MAB1234]']);
  assert.equal(s.alerts()[0].status, 'resolved');
});

test('"I’m at the bay": a real bay needs the camera or sensor to have just seen a car, and the driver within 150 m; a simulated bay only the geofence', async () => {
  const { s, book, setNow, calls } = setup();
  const real = await book(ANNA, 'bw-1', at('11:00'));
  const sim = await book(BEN, 'bw-3', at('11:00'));
  await assert.rejects(s.checkInManually(ANNA, real.id, HERE), { status: 409, message: /from 30 min before/ });
  setNow(at('10:45'));
  assert.equal(s.get(ANNA, real.id).carAtBay, false);
  await assert.rejects(s.checkInManually(ANNA, real.id, HERE), { status: 409, message: /camera hasn’t seen your car/ });
  await s.plateEvent('bw-1', '');
  assert.equal(s.get(ANNA, real.id).carAtBay, true);
  await assert.rejects(s.checkInManually(ANNA, real.id, FAR), { status: 403 });
  setNow(at('10:49'));
  await assert.rejects(s.checkInManually(ANNA, real.id, HERE), { status: 409 }, 'the evidence is over 3 min old');
  await s.plateEvent('bw-1', '');
  assert.equal((await s.checkInManually(ANNA, real.id, HERE)).checkInMethod, 'fallback');
  assert.deepEqual(calls, ['lower lock-0002']);
  assert.equal(s.get(BEN, sim.id).carAtBay, true);
  await assert.rejects(s.checkInManually(BEN, sim.id, FAR), { status: 403 });
  assert.equal((await s.checkInManually(BEN, sim.id, HERE)).status, 'arrived');
  assert.equal(calls.length, 1, 'simulated bays never call the hardware');
});

test('walk-up: a free bay, no booking within 30 min + the gap, until the next booking − the gap; idle fee after', async () => {
  const { s, book, setNow, calls } = setup();
  await book(BEN, 'bw-3', at('12:00'));
  const w = await s.unlock(ANNA, 'bw-3', HERE);
  assert.deepEqual([w.status, w.end, w.feeCents, w.checkInMethod], ['walkup', at('11:50'), 0, 'walkup']);
  assert.equal(s.bayView(BW3).status, 'occupied');
  await assert.rejects(s.unlock(BEN, 'bw-3', HERE), { status: 409 });
  setNow(at('11:58'));
  await s.vacated('bw-3');
  const done = s.get(ANNA, w.id);
  assert.deepEqual([done.status, done.totalCents], ['completed', 90], '3 min after the 5 free minutes');
  setNow(at('11:21'));
  await assert.rejects(s.unlock(ANNA, 'bw-3', HERE), { status: 409, message: /starts here soon/ });
  await assert.rejects(s.unlock(ANNA, 'bw-1', HERE), { status: 409, message: /camera hasn’t seen your car/ });
  s.carSeen('bw-1');
  await assert.rejects(s.unlock(ANNA, 'bw-1', FAR), { status: 403 });
  const real = await s.unlock(ANNA, 'bw-1', HERE);
  assert.equal(real.end, at('13:15'), 'no booking ahead: the class maximum (2 h) from the current block (11:15)');
  assert.deepEqual(calls, ['lower lock-0002']);
});

test('reminders: start ones only before the car arrives, end ones only while it’s in the bay', async () => {
  const { s, book, advance, setNow } = setup();
  const { id } = await book(ANNA, 'bw-3', at('11:00'));
  const keys = () => s.get(ANNA, id).sentReminders.map((r) => r.key);
  setNow(at('10:30'));
  await advance(0);
  assert.deepEqual(keys(), ['live']);
  setNow(at('10:55'));
  await advance(0);
  assert.deepEqual(keys(), ['live', 'five_before']);
  await s.plateEvent('bw-3', 'MAB1234');
  setNow(at('11:55'));
  await advance(0);
  assert.deepEqual(keys(), ['live', 'five_before', 'five_left']);
  s.finish(ANNA, id);
  await advance(10 * MIN);
  assert.deepEqual(keys(), ['live', 'five_before', 'five_left'], 'finished: no more reminders');
});

test('different car today: a one-off plate the camera also accepts, masked, and erased at the end', async () => {
  const { s, book, setNow } = setup();
  const { id } = await book(ANNA, 'bw-3', at('11:00'));
  assert.equal(s.setPlate(ANNA, id, { plate: 'b-xy 123' }).extraPlateHint, 'BX•••23');
  assert.throws(() => s.setPlate(BEN, id, { plate: 'B XY 123' }), { status: 404 });
  assert.throws(() => s.setPlate(ANNA, id, { plate: 'B' }), { status: 400 });
  setNow(at('10:45'));
  assert.deepEqual(await s.plateEvent('bw-3', 'BXY123'), { matched: true, matchedBy: 'exact' });
  assert.throws(() => s.setPlate(ANNA, id, { plate: 'B XY 124' }), { status: 409 }, 'only until arrival');
  s.finish(ANNA, id);
  const v = s.get(ANNA, id);
  assert.deepEqual([v.plateHint, v.extraPlateHint], [undefined, undefined]);
  const other = await book(ANNA, 'bw-3', at('14:00'));
  assert.equal(s.setPlate(ANNA, other.id, { vehicle: { plate: 'KLX4021', label: 'Van' } }).vehicleLabel, 'Van');
  assert.equal(s.get(ANNA, other.id).plateHint, 'KL•••21');
});

test('the bay view: status and LED from the schedule, the next booking, a price from quiet demand; no lock id', async () => {
  const { s, book } = setup();
  const free = s.bayView(BW1);
  assert.deepEqual([free.status, free.led, free.priceFromCents, 'lockId' in free], ['free', 'green', 200, false]);
  await book(BEN, 'bw-1', at('10:30'));
  assert.deepEqual([s.bayView(BW1).led, s.bayView(BW1).nextBookingAt], ['red', at('10:30')], 'a booking within 40 min');
  const later = setup();
  await later.book(BEN, 'bw-1', at('12:00'));
  assert.equal(later.s.bayView(BW1).led, 'green');
  assert.equal(later.s.bayView({ ...GE, fault: true }).status, 'offline');
});
