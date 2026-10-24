import test from 'node:test';
import assert from 'node:assert/strict';
import { createReservations, FALLBACK_EVIDENCE_MS, type Alert } from './reservation.ts';

const ANNA = 'user_anna';
const BEN = 'user_ben';
const CARL = 'user_carl';
const MIN = 60_000;
const BAY = { lat: 52.52, lng: 13.405 };

// A fast (DC) bay at normal demand: €5, a 15-min arrival grace
function setup() {
  let t = 1_000_000;
  const calls: string[] = [];
  const alerts: Alert[] = [];
  const hw = { reserve: async () => calls.push('reserve'), release: async () => calls.push('release') };
  const r = createReservations({ hw, type: 'fast', bay: BAY, now: () => t, onAlert: (a) => alerts.push(a) });
  const advance = async (ms: number) => {
    t += ms;
    await r.expire();
  };
  const book = (who = ANNA, plate = 'MAB1234', minutes = 60) => r.reserve(who, plate, 'Blue Zoe', minutes * MIN);
  return { r, calls, alerts, advance, book, now: () => t };
}

test('full cycle: reserve → plate check-in → charge → release', async () => {
  const { r, calls, book } = setup();
  await book(ANNA, 'm-ab 1234');
  await assert.rejects(book(BEN, 'B XY 1'), { status: 409 });
  assert.equal(r.state(ANNA).reservation?.totalCents, 500, 'fast at normal demand: €5');

  assert.deepEqual(await r.plateEvent('MAB1234'), { matched: true, matchedBy: 'exact' });
  assert.deepEqual(calls, ['reserve', 'release']);
  assert.equal(r.state(ANNA).reservation?.checkInMethod, 'camera');

  assert.throws(() => r.startCharging(BEN), { status: 403 }, 'only the reserving driver can act');
  r.startCharging(ANNA);
  r.finish(ANNA);
  const { reservation, log } = r.state(ANNA);
  assert.equal(reservation?.status, 'completed');
  assert.equal(reservation?.totalCents, 500, 'no overstay inside the session');
  assert.equal(reservation?.plateHint, null, 'plate is erased after the session');
  assert.ok(!JSON.stringify(log).includes('MAB1234'), 'log never contains plates');
  assert.equal(r.state(BEN).reservation, null, "others don't see someone else's ended session");
});

test('other drivers see the bay as busy and until when, but not whose car it is', async () => {
  const { r, book } = setup();
  const mine = await book(ANNA, 'MAB1234', 90);
  const theirs = r.state(BEN).reservation;
  assert.equal(r.state(ANNA).reservation?.plateHint, 'MA•••34');
  assert.equal(theirs?.mine, false);
  assert.equal(theirs?.end, mine.end, 'when the session ends is public');
  assert.equal(theirs?.plateHint, undefined);
  assert.equal(theirs?.charges, undefined);
  const json = JSON.stringify(r.state(null));
  assert.ok(!json.includes(ANNA) && !json.includes('MAB1234') && !json.includes('Blue Zoe'), 'public state leaks nothing personal');
});

test('the fee follows site demand, is capped at €10, and is fixed once the driver has seen it', async () => {
  const { r } = setup();
  assert.deepEqual([r.quote(null).cents, r.quote(null).demand], [500, 'Normal'], 'no demand data yet: normal');
  r.setOccupancy(0.15);
  assert.deepEqual([r.quote(null).cents, r.quote(null).demand], [400, 'Quiet']);
  r.setOccupancy(0.95);
  assert.deepEqual([r.quote(null).cents, r.quote(null).demand], [1000, 'Peak'], '2×: the €10 cap');
  await assert.rejects(r.reserve(ANNA, 'MAB1234', 'Car', 60 * MIN, 500), { status: 409 }, 'the price moved since the driver looked');
  const booked = await r.reserve(ANNA, 'MAB1234', 'Car', 60 * MIN, 1000);
  assert.deepEqual([booked.feeCents, booked.demand, booked.totalCents], [1000, 'Peak', 1000]);
  r.setOccupancy(0.15);
  assert.equal(r.state(ANNA).reservation?.feeCents, 1000, 'a later price change does not touch the booking');
});

test('sessions start now and last at most 2 h on a fast bay', async () => {
  const { r, book, now } = setup();
  await assert.rejects(book(ANNA, 'MAB1234', 121), { status: 400, message: /at most 2 h/ });
  await assert.rejects(book(ANNA, 'MAB1234', 0), { status: 400 });
  await assert.rejects(r.reserve(ANNA, 'MAB1234', 'Car', 'soon'), { status: 400 });
  const b = await book(ANNA, 'MAB1234', 120);
  assert.deepEqual([b.start, b.end, b.expiresAt], [now(), now() + 120 * MIN, now() + 15 * MIN], 'arrive within 15 min of booking');
});

test('running late: one +5 min extension for €0.50 moves the arrival deadline', async () => {
  const { r, book } = setup();
  const { expiresAt } = await book();
  const extended = r.extend(ANNA);
  assert.equal(extended.expiresAt, expiresAt + 5 * MIN);
  assert.equal(extended.totalCents, 550);
  assert.throws(() => r.extend(ANNA), { status: 409 }, 'only once');
  assert.throws(() => r.extend(BEN), { status: 403 });
});

test('no-show: 15 min of grace, then the bay is released and half the fee comes back', async () => {
  const { r, calls, advance, book } = setup();
  await book();
  await advance(15 * MIN);
  assert.equal(r.state(ANNA).reservation?.status, 'reserved', 'exactly 15 min late is still on time');
  await advance(1);
  const ns = r.state(ANNA).reservation;
  assert.equal(ns?.status, 'no_show');
  assert.equal(ns?.totalCents, 250, '50% of €5');
  assert.equal(ns?.charges?.at(-1)?.kind, 'released');
  assert.deepEqual(calls, ['reserve', 'release']);
  assert.deepEqual(await r.plateEvent('MAB1234'), { matched: false }, 'late arrival no longer opens the bay');
});

test('repeat no-shows: a warning at 2, prepaying at 3, and a prepaid no-show keeps the whole fee', async () => {
  const { r, advance, book } = setup();
  const noShow = async () => {
    await book();
    await advance(16 * MIN);
  };
  await noShow();
  assert.equal(r.quote(ANNA).warning, null);
  await noShow();
  assert.match(r.quote(ANNA).warning ?? '', /^Careful: you missed 2 of your last 2 bookings/);
  assert.equal(r.quote(ANNA).prepaid, false);
  await noShow();
  const q = r.quote(ANNA);
  assert.equal(q.prepaid, true);
  assert.equal(q.noShowCents, 500, 'prepaid: nothing back on a no-show');
  assert.equal(r.quote(BEN).prepaid, false, 'only the driver who missed');
  const prepaid = await book();
  assert.equal(prepaid.prepaid, true);
  await advance(16 * MIN);
  assert.equal(r.state(ANNA).reservation?.totalCents, 500, 'whole fee kept');
});

test('cancelling: free in the first 2 min or while the bay is blocked, then 60% of the no-show fee', async () => {
  const quick = setup();
  await quick.book();
  await quick.advance(2 * MIN);
  const free = await quick.r.cancel(ANNA);
  assert.equal(free.totalCents, 0);
  assert.equal(free.charges?.at(-1)?.kind, 'refund');

  const late = setup();
  await late.book();
  await late.advance(2 * MIN + 1);
  const paid = await late.r.cancel(ANNA);
  assert.equal(paid.totalCents, 150, '60% of the €2.50 no-show fee: the session had already started');
  assert.equal(paid.charges?.at(-1)?.kind, 'released');

  const extended = setup();
  await extended.book();
  extended.r.extend(ANNA);
  await extended.advance(5 * MIN);
  assert.equal((await extended.r.cancel(ANNA)).totalCents, 150, 'the extension comes back too');

  const blocked = setup();
  await blocked.book();
  await blocked.advance(5 * MIN);
  await blocked.r.plateEvent('BXY987');
  assert.equal((await blocked.r.cancel(ANNA)).totalCents, 0, 'not the driver’s fault');
});

test('overstay: 15 min after the session ends are free, then €0.25 a started minute', async () => {
  const { r, advance, book } = setup();
  await book(ANNA, 'MAB1234', 30);
  await r.plateEvent('MAB1234');
  r.startCharging(ANNA);
  await advance(30 * MIN + 15 * MIN);
  assert.equal(r.finish(ANNA).totalCents, 500, 'inside the grace');

  await book(ANNA, 'MAB1234', 30);
  await r.plateEvent('MAB1234');
  await advance(30 * MIN + 20 * MIN);
  await r.plateEvent('MAB1234', 'out');
  const out = r.state(ANNA).reservation;
  assert.equal(out?.status, 'completed', 'the car driving out ends the session');
  assert.equal(out?.charges?.at(-1)?.kind, 'overstay');
  assert.equal(out?.totalCents, 500 + 5 * 25);
});

test('end-of-session reminders: 1 h and 15 min before the end, only once the car is in the bay', async () => {
  const { r, advance, book } = setup();
  await book(ANNA, 'MAB1234', 120);
  await advance(5 * MIN);
  await r.plateEvent('MAB1234');
  await advance(55 * MIN);
  assert.deepEqual(r.state(ANNA).reservation?.sentReminders?.map((s) => s.key), ['ends_in_1h']);
  await advance(45 * MIN);
  await advance(MIN);
  assert.deepEqual(r.state(ANNA).reservation?.sentReminders?.map((s) => s.key), ['ends_in_1h', 'ends_in_15m'], 'each once');

  const early = setup();
  await early.book(ANNA, 'MAB1234', 16); // the 15-min reminder falls due a minute in, before the car arrives
  await early.advance(MIN);
  await early.r.plateEvent('MAB1234');
  await early.advance(MIN);
  assert.deepEqual(early.r.state(ANNA).reservation?.sentReminders, [], 'checked at send time: not sent while still reserved');
});

test('reserving hands the booked plate to the hardware; a refusal rolls the booking back, with its reason', async () => {
  const sent: unknown[] = [];
  const ok = createReservations({ hw: { reserve: async (plates?: string[]) => void sent.push(plates), release: async () => {} }, type: 'fast', bay: BAY });
  await ok.reserve(ANNA, 'm-ab 1234', 'Car', 60 * MIN);
  assert.deepEqual(sent, [['MAB1234']], 'normalised, for the camera’s own allow-list');

  const hw = { reserve: async () => { throw new Error('A car is over the arm, so it was not raised'); }, release: async () => {} };
  const r = createReservations({ hw, type: 'fast', bay: BAY });
  await assert.rejects(r.reserve(ANNA, 'MAB1234', 'Car', 60 * MIN), {
    status: 502,
    message: 'The bay could not be reserved: A car is over the arm, so it was not raised',
  });
  assert.equal(r.state(ANNA).reservation, null);
});

test('a hardware failure while cancelling is a 502, and the booking stays until it works', async () => {
  let down = true;
  const hw = { reserve: async () => {}, release: async () => { if (down) throw new Error('Lock 0002 is offline'); } };
  const r = createReservations({ hw, type: 'fast', bay: BAY });
  await r.reserve(ANNA, 'MAB1234', 'Car', 60 * MIN);
  await assert.rejects(r.cancel(ANNA), { status: 502, message: 'Could not release the bay: Lock 0002 is offline' });
  assert.equal(r.state(ANNA).reservation?.status, 'reserved');
  assert.equal(r.state(ANNA).reservation?.charges?.length, 1, 'no refund line yet');
  down = false;
  assert.equal((await r.cancel(ANNA)).status, 'cancelled');
});

test('the car leaving ends the session with no plate needed, or clears a car blocking the bay', async () => {
  const { r, book, advance } = setup();
  await book(ANNA, 'MAB1234', 30);
  r.vacated();
  assert.equal(r.state(ANNA).reservation?.status, 'reserved', 'nobody had checked in: nothing to end');
  await r.plateEvent('');
  await r.checkInManually(ANNA, BAY); // checked in by hand, so the camera never matched a plate
  await advance(50 * MIN);
  r.vacated();
  const done = r.state(ANNA).reservation;
  assert.equal(done?.status, 'completed');
  assert.equal(done?.totalCents, 500 + 5 * 25, 'overstay billed: 5 min past the 15-min grace');

  const blocked = setup();
  const { expiresAt } = await blocked.book();
  await blocked.r.plateEvent('BXY987');
  await blocked.advance(4 * MIN);
  blocked.r.vacated();
  const resumed = blocked.r.state(ANNA).reservation;
  assert.equal(resumed?.blockedSince, null);
  assert.equal(resumed?.expiresAt, expiresAt + 4 * MIN, 'the hold resumes, with the paused time added back');
});

test('only the reserving driver can cancel or finish', async () => {
  const { r, calls, book } = setup();
  await book();
  await assert.rejects(r.cancel(BEN), { status: 403 });
  assert.deepEqual(calls, ['reserve'], 'a rejected cancel must not release the bay');
  await r.plateEvent('MAB1234');
  assert.throws(() => r.finish(BEN), { status: 403 });
  assert.equal(r.state(ANNA).reservation?.status, 'arrived');
});

test('booking history only shows my own bookings', async () => {
  const { r, book } = setup();
  await book(ANNA);
  await r.cancel(ANNA);
  await book(BEN, 'BXY1');
  await r.cancel(BEN);
  await book(ANNA);
  await r.plateEvent('MAB1234');
  r.finish(ANNA);
  assert.deepEqual(r.bookings(ANNA).map((b) => b.status), ['completed', 'cancelled'], 'newest first');
  assert.deepEqual(r.bookings(BEN).map((b) => b.status), ['cancelled']);
  assert.ok(r.bookings(ANNA).every((b) => b.mine && b.plateHint === null), 'history keeps no plates');
});

test('waitlist: the first waiting driver gets a 2-minute priority window, then the next', async () => {
  const { r, advance, book } = setup();
  await book(ANNA);
  assert.deepEqual(r.notifyWhenFree(BEN), { position: 1 });
  assert.deepEqual(r.notifyWhenFree(CARL), { position: 2 });
  assert.equal(r.state(BEN).waiting, true);
  assert.throws(() => r.notifyWhenFree(ANNA), { status: 409 }, 'the owner can’t wait for their own bay');

  await r.cancel(ANNA);
  assert.equal(r.state(BEN).priority?.mine, true);
  assert.equal(r.state(CARL).priority?.mine, false);
  await assert.rejects(book(CARL, 'CDE5'), { status: 409, message: 'Held for a waiting driver' });

  await advance(2 * MIN);
  assert.equal(r.state(CARL).priority?.mine, true, 'Ben let it lapse, Carl is next');
  await book(CARL, 'CDE5');
  assert.equal(r.state(CARL).priority, null);
  assert.equal(r.state(CARL).waiting, false);
  const empty = createReservations({ hw: { reserve: async () => {}, release: async () => {} }, type: 'fast', bay: BAY });
  assert.throws(() => empty.notifyWhenFree(BEN), { status: 409 }, 'nothing to wait for when the bay is free');
});

test('blocked bay: another car pauses the arrival deadline, raises one alert, and resumes when it leaves', async () => {
  const { r, alerts, advance, book } = setup();
  const { expiresAt } = await book();
  await advance(5 * MIN);
  assert.deepEqual(await r.plateEvent('BXY987'), { matched: false });
  await r.plateEvent('BXY987');
  assert.equal(alerts.length, 1, 'one alert per incident, not per camera read');
  assert.equal(alerts[0].plate, 'BXY987', 'operators see the plate');
  assert.ok(r.state(ANNA).reservation?.blockedSince);
  assert.ok(r.state(BEN).blockedSince, 'the bay shows as blocked to everyone');
  assert.ok(!JSON.stringify(r.state(ANNA)).includes('BXY987'), 'drivers never see the other car’s plate');

  await advance(20 * MIN);
  assert.equal(r.state(ANNA).reservation?.status, 'reserved', 'paused: no no-show while blocked');

  await r.plateEvent('BXY987', 'out');
  const resumed = r.state(ANNA).reservation;
  assert.equal(resumed?.blockedSince, null);
  assert.equal(resumed?.expiresAt, expiresAt + 20 * MIN, 'the paused time is added back');
  assert.equal(resumed?.blockedMs, 20 * MIN);
  assert.equal(alerts[0].status, 'resolved');
  assert.equal(alerts[0].resolvedBy, 'camera');
  assert.equal(alerts[0].plate, null, 'plate erased on resolve');
});

test('operator resolve clears the bay, resumes the hold and erases the plate', async () => {
  const { r, advance, book } = setup();
  await book();
  await r.plateEvent('BXY987');
  const [alert] = r.operatorState().alerts;
  assert.equal(alert.plate, 'BXY987');
  await advance(3 * MIN);
  const resolved = r.resolveAlert(alert.id);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedBy, 'operator');
  assert.equal(resolved.plate, null);
  assert.equal(r.state(ANNA).reservation?.blockedSince, null);
  assert.equal(r.operatorState().blockedSince, null);
  assert.throws(() => r.resolveAlert(alert.id), { status: 409 });
  assert.throws(() => r.resolveAlert('nope'), { status: 404 });
});

test('a car charging without a booking makes the bay unavailable, without an alert', async () => {
  const { r, alerts, book } = setup();
  await r.plateEvent('BXY987');
  await assert.rejects(book(ANNA), { status: 409, message: 'A car is in the bay right now' });
  assert.deepEqual(r.notifyWhenFree(ANNA), { position: 1 });
  assert.equal(alerts.length, 0);
  await r.plateEvent('BXY987', 'out');
  assert.equal(r.state(ANNA).priority?.mine, true, 'the waiting driver is offered the bay');
  await book(ANNA);
});

test('a misread plate still checks the booked car in; a different plate does not', async () => {
  const { r, book } = setup();
  await book();
  assert.deepEqual(await r.plateEvent('MA81234'), { matched: true, matchedBy: 'fuzzy' });
  assert.equal(r.state(ANNA).reservation?.matchedBy, 'fuzzy');

  const other = setup();
  await other.book();
  assert.deepEqual(await other.r.plateEvent('KLX4021'), { matched: false });
  assert.equal(other.r.state(ANNA).reservation?.status, 'reserved');
  assert.equal(other.alerts.length, 1, 'a different plate is a blocking car');
});

test('unreadable plate: no alert, and the driver can check in at the bay instead', async () => {
  const { r, alerts, calls, book } = setup();
  await book();
  await r.plateEvent('');
  assert.ok(r.state(ANNA).reservation?.unreadableAt);
  assert.equal(alerts.length, 0);
  assert.equal(r.state(ANNA).blockedSince, null);

  await assert.rejects(r.checkInManually(ANNA, { lat: BAY.lat + 0.0018, lng: BAY.lng }), { status: 403 }, '200 m away is too far');
  await assert.rejects(r.checkInManually(ANNA, { lat: 'x', lng: BAY.lng }), { status: 400 });
  assert.deepEqual(calls, ['reserve'], 'a rejected check-in must not release the bay');
  const inside = await r.checkInManually(ANNA, { lat: BAY.lat + 0.00045, lng: BAY.lng });
  assert.equal(inside.status, 'arrived');
  assert.equal(inside.checkInMethod, 'fallback');
  assert.deepEqual(calls, ['reserve', 'release']);
});

test('fallback check-in needs the camera to have seen a car in the last 3 min: location alone never opens the bay', async () => {
  const { r, calls, book, advance } = setup();
  await book();
  await assert.rejects(r.checkInManually(ANNA, BAY), { status: 409 }, 'no evidence, even inside the geofence');
  assert.equal(r.state(ANNA).reservation?.carAtBay, false);

  await r.plateEvent('');
  assert.equal(r.state(ANNA).reservation?.carAtBay, true, 'the app shows "I’m at the bay"');
  assert.equal(r.state(BEN).reservation?.carAtBay, undefined, 'owner only');
  await advance(FALLBACK_EVIDENCE_MS + 1);
  assert.equal(r.state(ANNA).reservation?.carAtBay, false);
  await assert.rejects(r.checkInManually(ANNA, BAY), { status: 409 }, 'the evidence is too old');
  assert.deepEqual(calls, ['reserve'], 'the bay stays closed');

  await r.plateEvent('');
  assert.equal((await r.checkInManually(ANNA, BAY)).checkInMethod, 'fallback');
});

test('fallback check-in is refused while another car is in the bay', async () => {
  const { r, book } = setup();
  await book();
  await r.plateEvent('BXY987');
  await assert.rejects(r.checkInManually(ANNA, BAY), { status: 409 });
});

test('different car today: the camera accepts the second plate, which is erased afterwards', async () => {
  const { r, book } = setup();
  await book();
  assert.equal(r.useOtherPlate(ANNA, 'B XY 123').extraPlateHint, 'BX•••23');
  assert.throws(() => r.useOtherPlate(BEN, 'B XY 123'), { status: 403 });
  assert.deepEqual(await r.plateEvent('BXY123'), { matched: true, matchedBy: 'exact' });
  r.finish(ANNA);
  const done = r.state(ANNA).reservation;
  assert.equal(done?.extraPlateHint, null);
  assert.ok(!JSON.stringify([r.state(ANNA), r.bookings(ANNA)]).includes('BXY123'));
});
