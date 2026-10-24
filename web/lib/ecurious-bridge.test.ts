import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from './ecurious-bridge.ts';
import type { HwEvent } from './ecurious-events.ts';

const BOOKED = 'MAB1234';
const BAY = 'lock-0002';
const photo = (plate: string, lockId = BAY): HwEvent => ({ type: 'photo', lockId, plate });
const occupied: HwEvent = { type: 'presence', lockId: BAY, presence: 'occupied' };
const vacant: HwEvent = { type: 'presence', lockId: BAY, presence: 'vacant' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stand-in for the reservation engine: BOOKED checks in while reserved, and the session completes when the car leaves
function setup(status: string | null = 'reserved', presence = 'vacant') {
  const calls: string[] = [];
  let t = 0;
  const engine = {
    status,
    async plateEvent(plate: unknown, dir: 'in' | 'out' = 'in') {
      calls.push(`${dir}:${plate}`);
      const matched = plate === BOOKED && (dir === 'in' ? this.status === 'reserved' : this.status === 'arrived');
      if (matched) this.status = dir === 'in' ? 'arrived' : 'completed';
      return { matched };
    },
    vacated() {
      calls.push('out');
      if (this.status === 'arrived') this.status = 'completed';
    },
    state() {
      return { reservation: this.status ? { status: this.status } : null };
    },
  };
  const bridge = createBridge(engine, { lockId: BAY, presence, vacantMs: 20, now: () => t });
  return { engine, calls, bridge, advance: (ms: number) => (t += ms) };
}

test('a plate read while the bay is held checks in at once; other bays are ignored', async () => {
  const { bridge, calls, engine } = setup();
  await bridge.handle(photo(BOOKED, 'lock-0003'));
  await bridge.handle(photo(BOOKED));
  assert.deepEqual(calls, ['in:MAB1234']);
  assert.equal(engine.status, 'arrived');
});

test('an unbooked bay: a car driving past changes nothing, a car pulling in is reported with its plate', async () => {
  const { bridge, calls, advance } = setup(null);
  await bridge.handle(photo('BXY99'));
  assert.deepEqual(calls, [], 'read, but the sensor still says vacant');
  await bridge.handle(occupied);
  assert.deepEqual(calls, ['in:BXY99']);
  await bridge.handle(vacant);
  await sleep(40);
  await bridge.handle(photo('BXY99'));
  advance(3 * 60_000);
  await bridge.handle(occupied);
  assert.deepEqual(calls, ['in:BXY99', 'out', 'in:'], 'a read 3 min before the car pulled in is too old: unreadable');
});

test('the car left: only once the bay stayed empty, and with no plate needed; a sensor flicker does nothing', async () => {
  const { bridge, calls, engine } = setup();
  await bridge.handle(photo(BOOKED)); // checks in, the engine lowers the arm
  await bridge.handle(occupied); // pulls in
  await bridge.handle(vacant);
  await bridge.handle(occupied); // flicker within the debounce
  await sleep(40);
  assert.ok(!calls.some((c) => c.startsWith('out')), 'a flicker is not a departure');
  assert.equal(engine.status, 'arrived');
  await bridge.handle(vacant);
  await sleep(40);
  assert.equal(calls.at(-1), 'out');
  assert.equal(engine.status, 'completed');
});

test('a repeated vacant reading keeps the departure; the next car keeps its plate read', async () => {
  const { bridge, calls, engine, advance } = setup();
  await bridge.handle(photo(BOOKED));
  await bridge.handle(occupied);
  await bridge.handle(vacant);
  await bridge.handle(vacant); // the sensor reports again within the debounce
  advance(1);
  await bridge.handle(photo('BXY99')); // the next car pulls up before the departure fires
  await sleep(40);
  assert.equal(engine.status, 'completed');
  await bridge.handle(occupied);
  assert.equal(calls.at(-1), 'in:BXY99');
});

test('vacant without a car before it is not a departure', async () => {
  for (const presence of ['vacant', '']) {
    const { bridge, calls } = setup('arrived', presence);
    await bridge.handle(vacant);
    await sleep(40);
    assert.deepEqual(calls, []);
  }
});

test('events are applied one at a time, and a failing one does not stop the next', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const order: string[] = [];
  const engine = {
    async plateEvent(plate: unknown) {
      order.push(`start ${plate}`);
      await sleep(15); // the arm moving
      order.push(`end ${plate}`);
      if (plate === 'FAIL') throw new Error('Could not release the bay: HTTP 502');
      return { matched: false };
    },
    vacated() {},
    state: () => ({ reservation: { status: 'reserved' } }),
  };
  const bridge = createBridge(engine, { lockId: BAY });
  void bridge.handle(photo('FAIL'));
  await bridge.handle(photo('NEXT'));
  assert.deepEqual(order, ['start FAIL', 'end FAIL', 'start NEXT', 'end NEXT']);
  assert.match(String(logged.mock.calls[0].arguments[0]), /event not applied: Could not release the bay/);
});
