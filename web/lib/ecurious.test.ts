import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as hw from './ecurious.ts';

const KEY = 'pkl_live_test_secret';
const BASE = 'https://parking-lock-service-production.up.railway.app/api/v1';

// The team's bays as the live probe returned them on 2026-10-24 (the camera list really was ['*'])
const lock2 = () => ({
  id: 'lock-0002',
  name: 'Lock 0002',
  serialHex: '6688202620000002',
  hasCamera: true,
  status: 'raised',
  carPresence: 'vacant',
  deviceStatusRaw: 1,
  carPresenceRaw: 2,
  battery12V: 15.1,
  battery3_7V: 0,
  signalStrength4G: 0,
  waterIngress: false,
  activeErrors: [] as string[],
  lastSeenAt: '2026-10-24T10:53:57.139Z',
  whitelist: ['*'],
});
const lock1 = () => ({ ...lock2(), id: 'lock-0001', name: 'Lock 0001', status: 'offline', lastSeenAt: '2026-10-24T10:29:56.817Z' });

type Call = { method: string; path: string; headers: Record<string, string>; body?: { plates?: string[] } };
type Bay = ReturnType<typeof lock2>;

// Stubs fetch with a small fake Ecurious server that serves `bay` as lock-0002. `override` can answer first.
function fake(bay: Bay = lock2(), override?: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c: Call = {
      method: init.method ?? 'GET',
      path: String(url).replace(BASE, ''),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    const custom = override?.(c);
    if (custom) return custom;
    const p = c.path.replace('/locks/lock-0002', '');
    if (c.path === '/locks') return Response.json({ team: 'Baywatch', locks: [lock1(), bay], assignedLocks: [lock1(), bay] });
    if (p === '') return Response.json({ lock: bay });
    if (p === '/lock') return (bay.status = 'raised'), Response.json({ success: true, result: { deviceStatus: 1, success: true } });
    if (p === '/unlock') return (bay.status = 'lowered'), Response.json({ success: true, result: { deviceStatus: 2, success: true } });
    if (p === '/whitelist') return (bay.whitelist = c.body!.plates!), Response.json({ success: true, whitelist: bay.whitelist });
    return Response.json({ error: 'Lock not found' }, { status: 404 });
  }) as typeof fetch;
  return calls;
}
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);
const cache = () => (globalThis as unknown as { ecurious_v1: { triedAt: number; reading?: Promise<void> } }).ecurious_v1;

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { ecurious_v1?: unknown }).ecurious_v1;
  Object.assign(process.env, { ECURIOUS_API_KEY: KEY, ECURIOUS_LIVE: '1', ECURIOUS_LOCK_ID: 'lock-0002' });
  delete process.env.ECURIOUS_MOCK;
  delete process.env.ECURIOUS_WHITELIST;
});

test('the mock, never the hardware, unless the key and ECURIOUS_LIVE=1 are set (and ECURIOUS_MOCK=1 is not)', async () => {
  const calls = fake();
  for (const env of [{ ECURIOUS_API_KEY: '' }, { ECURIOUS_LIVE: '' }, { ECURIOUS_MOCK: '1' }]) {
    delete (globalThis as { ecurious_v1?: unknown }).ecurious_v1;
    Object.assign(process.env, env);
    assert.deepEqual(await hw.status(), { state: 'free', mock: true });
    await hw.reserve(['MAB1234']);
    assert.deepEqual(await hw.status(), { state: 'blocked', mock: true });
    await hw.release();
    assert.deepEqual(await hw.status(), { state: 'free', mock: true });
    Object.assign(process.env, { ECURIOUS_API_KEY: KEY, ECURIOUS_LIVE: '1', ECURIOUS_MOCK: '' });
  }
  assert.equal(calls.length, 0);
});

test('status: the real fields, no plates, and one hardware read for many polls', async () => {
  const calls = fake();
  const s = await hw.status();
  assert.deepEqual(s, {
    state: 'blocked',
    mock: false,
    lockId: 'lock-0002',
    name: 'Lock 0002',
    online: true,
    carPresence: 'vacant',
    autoUnlock: 'any',
    battery12V: 15.1,
    battery3_7V: 0,
    signalStrength4G: 0,
    waterIngress: false,
    activeErrors: [],
    lastSeenAt: '2026-10-24T10:53:57.139Z',
    events: false,
    stale: false,
    error: undefined,
    updatedAt: s.updatedAt,
  });
  await Promise.all([hw.status(), hw.status(), hw.status()]);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/locks', '/locks/lock-0002'],
    'polls within 5 s come from the cache',
  );
});

test('an offline bay: online false, and the last position it reported', async () => {
  process.env.ECURIOUS_LOCK_ID = 'lock-0001';
  fake(lock2(), (c) => (c.path === '/locks/lock-0001' ? Response.json({ lock: { ...lock1(), deviceStatusRaw: 2 } }) : undefined));
  const s = await hw.status();
  assert.deepEqual([s.online, s.state], [false, 'free']);
});

test('status never throws: a failed read serves the last value as stale, and is not repeated per poll', async () => {
  let down = false;
  const calls = fake(lock2(), (c) => (down && c.method === 'GET' ? new Response('', { status: 503 }) : undefined));
  await hw.status();
  cache().triedAt -= 6_000; // the cache is now older than the 5 s TTL
  down = true;
  const before = calls.length;
  assert.equal((await hw.status()).state, 'blocked', 'answers at once from the cache while it re-reads');
  await cache().reading;
  const s = await hw.status();
  assert.deepEqual([s.state, s.stale, s.error], ['blocked', true, 'GET /locks/lock-0002: HTTP 503']);
  assert.equal(calls.length - before, 3, 'a read is tried 3 times');
  await hw.status();
  assert.equal(calls.length - before, 3, 'and not again within 5 s');
});

test('the key goes only in the X-API-Key header, never in a URL, an error or the status', async () => {
  const calls = fake(lock2(), (c) => (c.path === '/locks/lock-0002' ? Response.json({ error: `Invalid API key ${KEY}` }, { status: 401 }) : undefined));
  await assert.rejects(hw.call('GET', '/locks/lock-0002'), (e: Error) => !e.message.includes(KEY) && e.message.includes('[key]'));
  assert.equal(calls.length, 1, 'a 4xx is not retried');
  const s = await hw.status();
  assert.ok(s.stale && !JSON.stringify(s).includes(KEY));
  assert.ok(calls.every((c) => c.headers['x-api-key'] === KEY && !c.path.includes(KEY)));
});

test('reads retry timeouts with backoff; writes are never retried, and time out on their own', async () => {
  let timeouts = 2;
  const timeout = () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const calls = fake(lock2(), (c) => {
    if (c.path === '/locks/lock-0002' && timeouts-- > 0) timeout();
    if (c.path.endsWith('/unlock')) return new Response('', { status: 502 });
    if (c.path.endsWith('/lock')) timeout();
    return undefined;
  });
  assert.equal((await hw.call<{ lock: Bay }>('GET', '/locks/lock-0002')).lock.id, 'lock-0002');
  assert.equal(calls.length, 3, 'two timeouts, then the answer');
  await assert.rejects(hw.call('POST', '/locks/lock-0002/unlock', { cancelAutoLift: true }), { message: 'POST /locks/lock-0002/unlock: HTTP 502' });
  await assert.rejects(hw.call('POST', '/locks/lock-0002/lock', { cancelAutoLift: true }), { message: 'POST /locks/lock-0002/lock: no answer in 8 s' });
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2);
});

test('reserve never raises the arm over a car or on an offline bay', async () => {
  const bay = { ...lock2(), status: 'lowered', carPresence: 'occupied' };
  const calls = fake(bay);
  await assert.rejects(hw.reserve(['MAB1234']), /car is over the arm/);
  Object.assign(bay, { carPresence: 'vacant', status: 'offline' });
  await assert.rejects(hw.reserve(['MAB1234']), /Lock 0002 is offline/);
  assert.deepEqual(posts(calls), []);
});

test('reserve raises the arm and stops the camera lowering it for any car; release lowers it for good', async () => {
  const calls = fake({ ...lock2(), status: 'lowered' });
  await hw.reserve(['MAB1234']);
  assert.equal((await hw.status()).state, 'blocked');
  await hw.release();
  assert.deepEqual((await hw.status()).state, 'free');
  assert.deepEqual(posts(calls), [
    ['/locks/lock-0002/lock', { cancelAutoLift: true }],
    ['/locks/lock-0002/whitelist', { plates: [] }], // ['*'] goes: during a hold no car lowers the arm by itself
    ['/locks/lock-0002/unlock', { cancelAutoLift: true }], // stays down, under the car and after it leaves
  ]);

  // ECURIOUS_WHITELIST=1: the camera lowers the arm itself for the booked car only, until the booking ends
  process.env.ECURIOUS_WHITELIST = '1';
  calls.length = 0;
  await hw.reserve(['MAB1234']);
  await hw.release();
  assert.deepEqual(posts(calls), [
    ['/locks/lock-0002/lock', { cancelAutoLift: true }],
    ['/locks/lock-0002/whitelist', { plates: ['MAB1234'] }],
    ['/locks/lock-0002/unlock', { cancelAutoLift: true }],
    ['/locks/lock-0002/whitelist', { plates: [] }],
  ]);
});

test('a camera list that fails or drops the plate does not fail the booking, and shows in status', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  process.env.ECURIOUS_WHITELIST = '1';
  const bay = { ...lock2(), status: 'lowered' };
  // the second spec example: the camera kept only plates with a Chinese province prefix
  fake(bay, (c) => (c.path.endsWith('/whitelist') ? Response.json({ success: true, whitelist: [] }) : undefined));
  await hw.reserve(['MAB1234']);
  assert.equal((await hw.status()).autoUnlock, 'off');
  assert.match(String(warn.mock.calls.at(-1)?.arguments[0]), /did not store every plate/);
});

test('after a failed command the next one is refused for 30 s without reaching the hardware', async () => {
  const calls = fake(lock2(), (c) => (c.path.endsWith('/unlock') ? new Response('', { status: 504 }) : undefined));
  await assert.rejects(hw.release(), { message: 'POST /locks/lock-0002/unlock: HTTP 504' });
  await assert.rejects(hw.release(), /try again in \d+ s/);
  await assert.rejects(hw.reserve(), /try again in \d+ s/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

test("only the team's own bays: an unknown ECURIOUS_LOCK_ID is refused before any command", async () => {
  process.env.ECURIOUS_LOCK_ID = 'lock-0099';
  const calls = fake();
  await assert.rejects(hw.release(), { message: "lock-0099 is not one of this team's bays" });
  assert.deepEqual(posts(calls), []);
  const s = await hw.status();
  assert.deepEqual([s.state, s.error], ['unknown', "lock-0099 is not one of this team's bays"]);
});

test("without ECURIOUS_LOCK_ID: the team's first bay, with a warning", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  delete process.env.ECURIOUS_LOCK_ID;
  fake();
  assert.equal(await hw.lockId(), 'lock-0001');
  assert.match(String(warn.mock.calls[0].arguments[0]), /first bay, lock-0001/);
});

test('events keep the cached status current between reads', async () => {
  fake();
  await hw.status();
  hw.noteEvent({ type: 'arm', lockId: 'lock-0002', arm: 'lowered' });
  hw.noteEvent({ type: 'presence', lockId: 'lock-0002', presence: 'occupied' });
  hw.noteEvent({ type: 'alarm', lockId: 'lock-0002', error: 'water_ingress' });
  hw.noteEvent({ type: 'presence', lockId: 'lock-0003', presence: 'vacant' }); // another bay
  hw.noteStream(true);
  const s = await hw.status();
  assert.deepEqual([s.state, s.carPresence, s.activeErrors, s.events], ['free', 'occupied', ['water_ingress'], true]);
});
