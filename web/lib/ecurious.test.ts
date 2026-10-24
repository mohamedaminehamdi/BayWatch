import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as hw from './ecurious.ts';

const KEY = 'pkl_live_test_secret';
const BASE = 'https://parking-lock-service-production.up.railway.app/api/v1';

// The team's locks as the live probe returned them on 2026-10-24 (the camera list really was ['*'])
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
const lock3 = () => ({ ...lock2(), id: 'lock-0003', name: 'Lock 0003', serialHex: '6688202620000003', status: 'lowered', deviceStatusRaw: 2 });

type Call = { method: string; path: string; headers: Record<string, string>; body?: { plates?: string[] } };
type Lock = ReturnType<typeof lock2>;

// Stubs fetch with a small fake Ecurious server for the team's two locks. lock-0001 isn't the team's any more.
function fake(locks: Record<string, Lock> = { 'lock-0002': lock2(), 'lock-0003': lock3() }, override?: (c: Call) => Response | undefined) {
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
    if (c.path === '/locks') return Response.json({ team: 'Baywatch', locks: Object.values(locks), assignedLocks: Object.values(locks) });
    const [, id, action] = /^\/locks\/([^/]+)(?:\/(.+))?$/.exec(c.path) ?? [];
    const lock = locks[id];
    if (!lock) return Response.json({ error: `Lock '${id}' not found` }, { status: 404 });
    if (!action) return Response.json({ lock });
    if (action === 'lock') return (lock.status = 'raised'), Response.json({ success: true, result: { deviceStatus: 1, success: true } });
    if (action === 'unlock') return (lock.status = 'lowered'), Response.json({ success: true, result: { deviceStatus: 2, success: true } });
    if (action === 'whitelist') return (lock.whitelist = c.body!.plates!), Response.json({ success: true, whitelist: lock.whitelist });
    return Response.json({ error: 'Not found' }, { status: 404 });
  }) as typeof fetch;
  return calls;
}
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);
const cache = (id = 'lock-0002') => (globalThis as unknown as { ecurious_v2: { locks: Record<string, { triedAt: number; reading?: Promise<void> }> } }).ecurious_v2.locks[id];

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { ecurious_v2?: unknown }).ecurious_v2;
  Object.assign(process.env, { ECURIOUS_API_KEY: KEY, ECURIOUS_LIVE: '1' });
  delete process.env.ECURIOUS_MOCK;
  delete process.env.ECURIOUS_WHITELIST;
  delete process.env.ECURIOUS_LOCK_ID;
});

test('the mock, never the hardware, unless the key and ECURIOUS_LIVE=1 are set (and ECURIOUS_MOCK=1 is not)', async () => {
  const calls = fake();
  for (const env of [{ ECURIOUS_API_KEY: '' }, { ECURIOUS_LIVE: '' }, { ECURIOUS_MOCK: '1' }]) {
    delete (globalThis as { ecurious_v2?: unknown }).ecurious_v2;
    Object.assign(process.env, env);
    assert.deepEqual(await hw.status('lock-0002'), { state: 'blocked', mock: true }, 'guarded between sessions');
    await hw.lower('lock-0002');
    assert.deepEqual(await hw.status('lock-0002'), { state: 'free', mock: true });
    assert.deepEqual(await hw.status('lock-0003'), { state: 'blocked', mock: true }, 'each lock on its own');
    await hw.raise('lock-0002', ['MAB1234']);
    assert.deepEqual(await hw.status('lock-0002'), { state: 'blocked', mock: true });
    Object.assign(process.env, { ECURIOUS_API_KEY: KEY, ECURIOUS_LIVE: '1', ECURIOUS_MOCK: '' });
  }
  assert.equal(calls.length, 0);
});

test('status: the real fields, no plates, and one hardware read for many polls', async () => {
  const calls = fake();
  const s = await hw.status('lock-0002');
  assert.deepEqual(s, {
    state: 'blocked',
    mock: false,
    lockId: 'lock-0002',
    name: 'Lock 0002',
    online: true,
    carPresence: 'vacant',
    autoUnlock: 'any',
    listOk: false, // ['*'] while nothing is booked: any car would lower the arm
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
  await Promise.all([hw.status('lock-0002'), hw.status('lock-0002'), hw.status('lock-0002')]);
  assert.deepEqual(calls.map((c) => c.path), ['/locks', '/locks/lock-0002'], 'polls within 5 s come from the cache');
  assert.equal((await hw.status('lock-0003')).state, 'free');
  assert.equal(calls.length, 2, 'the team list already had lock-0003: no extra read');
});

test('an offline lock: online false, and the last position it reported', async () => {
  const offline = { ...lock3(), status: 'offline', deviceStatusRaw: 2 };
  fake({ 'lock-0002': lock2(), 'lock-0003': offline });
  const s = await hw.status('lock-0003');
  assert.deepEqual([s.online, s.state], [false, 'free']);
});

test('status never throws: a failed read serves the last value as stale, and is not repeated per poll', async () => {
  let down = false;
  const calls = fake(undefined, (c) => (down && c.method === 'GET' ? new Response('', { status: 503 }) : undefined));
  await hw.status('lock-0002');
  cache().triedAt -= 6_000; // the cache is now older than the 5 s TTL
  down = true;
  const before = calls.length;
  assert.equal((await hw.status('lock-0002')).state, 'blocked', 'answers at once from the cache while it re-reads');
  await cache().reading;
  const s = await hw.status('lock-0002');
  assert.deepEqual([s.state, s.stale, s.error], ['blocked', true, 'GET /locks/lock-0002: HTTP 503']);
  assert.equal(calls.length - before, 3, 'a read is tried 3 times');
  await hw.status('lock-0002');
  assert.equal(calls.length - before, 3, 'and not again within 5 s');
});

test('the key goes only in the X-API-Key header, never in a URL, an error or the status', async () => {
  const calls = fake(undefined, (c) => (c.path === '/locks/lock-0002' ? Response.json({ error: `Invalid API key ${KEY}` }, { status: 401 }) : undefined));
  await assert.rejects(hw.call('GET', '/locks/lock-0002'), (e: Error) => !e.message.includes(KEY) && e.message.includes('[key]'));
  assert.equal(calls.length, 1, 'a 4xx is not retried');
  const s = await hw.status('lock-0002');
  assert.ok(s.stale && !JSON.stringify(s).includes(KEY));
  assert.ok(calls.every((c) => c.headers['x-api-key'] === KEY && !c.path.includes(KEY)));
});

test('reads retry timeouts with backoff; writes are never retried, and time out on their own', async () => {
  let timeouts = 2;
  const timeout = () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const calls = fake(undefined, (c) => {
    if (c.path === '/locks/lock-0002' && timeouts-- > 0) timeout();
    if (c.path.endsWith('/unlock')) return new Response('', { status: 502 });
    if (c.path.endsWith('/lock')) timeout();
    return undefined;
  });
  assert.equal((await hw.call<{ lock: Lock }>('GET', '/locks/lock-0002')).lock.id, 'lock-0002');
  assert.equal(calls.length, 3, 'two timeouts, then the answer');
  await assert.rejects(hw.call('POST', '/locks/lock-0002/unlock', { cancelAutoLift: true }), { message: 'POST /locks/lock-0002/unlock: HTTP 502' });
  await assert.rejects(hw.call('POST', '/locks/lock-0002/lock', { cancelAutoLift: true }), { message: 'POST /locks/lock-0002/lock: no answer in 8 s' });
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2);
});

test('raise never puts the arm up onto a car or on an offline lock', async () => {
  const lock = { ...lock2(), status: 'lowered', carPresence: 'occupied' };
  const calls = fake({ 'lock-0002': lock, 'lock-0003': lock3() });
  await assert.rejects(hw.raise('lock-0002', ['MAB1234']), { message: 'A car is over the arm, so it was not raised' });
  Object.assign(lock, { carPresence: 'vacant', status: 'offline' });
  await assert.rejects(hw.raise('lock-0002', ['MAB1234']), /Lock 0002 is offline/);
  assert.deepEqual(posts(calls), []);
});

test('raise puts the arm up with the booked plate on the camera’s list; lower takes it down for good and empties the list', async () => {
  const calls = fake({ 'lock-0002': { ...lock2(), status: 'lowered' }, 'lock-0003': lock3() });
  assert.deepEqual(await hw.raise('lock-0002', ['m-ab 1234', 'B XY 123']), { autoUnlock: 'camera' }, 'the camera echoed both plates');
  assert.equal((await hw.status('lock-0002')).state, 'blocked');
  await hw.lower('lock-0002');
  assert.equal((await hw.status('lock-0002')).state, 'free');
  assert.deepEqual(await hw.raise('lock-0002'), { autoUnlock: 'app' }, 'no plates: nobody gets in by the camera');
  await hw.raise('lock-0002');
  assert.deepEqual(posts(calls), [
    ['/locks/lock-0002/lock', { cancelAutoLift: true }],
    ['/locks/lock-0002/whitelist', { plates: ['MAB1234', 'BXY123'] }], // normalised like the app's own matcher
    ['/locks/lock-0002/unlock', { cancelAutoLift: true }], // stays down, under the car
    ['/locks/lock-0002/whitelist', { plates: [] }], // the plate can't open the bay outside its slot
    ['/locks/lock-0002/lock', { cancelAutoLift: true }], // up again once the car has left; the list is already empty
  ], 'an arm already up gets no second command');
  assert.ok(
    calls.filter((c) => c.path.endsWith('/whitelist')).every((c) => Object.keys(c.body!).join() === 'plates'),
    'only ever { plates }: never { wildcard: true }',
  );

  // ECURIOUS_WHITELIST=0: the camera lowers the arm for nobody, the app's own match does it
  process.env.ECURIOUS_WHITELIST = '0';
  calls.length = 0;
  await hw.lower('lock-0002');
  assert.deepEqual(await hw.raise('lock-0002', ['MAB1234']), { autoUnlock: 'app' });
  assert.deepEqual(posts(calls), [
    ['/locks/lock-0002/unlock', { cancelAutoLift: true }],
    ['/locks/lock-0002/lock', { cancelAutoLift: true }],
  ]);
});

test('a camera list that fails or drops the plate does not fail the booking: the app’s match takes over, and status shows it', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  // the second spec example: the camera kept only plates with a Chinese province prefix
  fake({ 'lock-0002': { ...lock2(), status: 'lowered' }, 'lock-0003': lock3() }, (c) =>
    c.path.endsWith('/whitelist') ? Response.json({ success: true, message: 'Configured whitelist rules on lock.', whitelist: [] }) : undefined,
  );
  assert.deepEqual(await hw.raise('lock-0002', ['MAB1234']), { autoUnlock: 'app' });
  assert.equal((await hw.status('lock-0002')).autoUnlock, 'off');
  const said = String(warn.mock.calls.at(-1)?.arguments[0]);
  assert.match(said, /did not store the booked plate/);
  assert.ok(!said.includes('MAB1234'), 'no plate in the log');
});

test('after a failed command, that lock refuses new ones for 30 s without reaching the hardware; other locks carry on', async () => {
  const calls = fake(undefined, (c) => (c.path === '/locks/lock-0002/unlock' ? new Response('', { status: 504 }) : undefined));
  await assert.rejects(hw.lower('lock-0002'), { message: 'POST /locks/lock-0002/unlock: HTTP 504' });
  await assert.rejects(hw.lower('lock-0002'), /try again in \d+ s/);
  await hw.lower('lock-0003');
  assert.deepEqual(posts(calls).map(([p]) => p), ['/locks/lock-0002/unlock', '/locks/lock-0003/unlock', '/locks/lock-0003/whitelist']);
});

test("only the team's own locks: lock-0001 is refused before any call to it", async () => {
  const calls = fake();
  await assert.rejects(hw.lower('lock-0001'), { message: "lock-0001 is not one of this team's bays" });
  await assert.rejects(hw.raise('lock-0001', []), { message: "lock-0001 is not one of this team's bays" });
  const s = await hw.status('lock-0001');
  assert.deepEqual([s.state, s.online, s.error], ['unknown', false, "lock-0001 is not one of this team's bays"]);
  assert.ok(calls.every((c) => !c.path.includes('lock-0001')), 'never called, not even read');
  assert.deepEqual(await hw.teamLocks(), ['lock-0002', 'lock-0003']);
});

test("the CLI's lock: exactly ECURIOUS_LOCK_ID, one of the team's own, and no fallback", async () => {
  fake();
  await assert.rejects(hw.lockId(), /Set ECURIOUS_LOCK_ID/);
  process.env.ECURIOUS_LOCK_ID = 'lock-0003';
  assert.equal(await hw.lockId(), 'lock-0003');
  process.env.ECURIOUS_LOCK_ID = 'lock-0001';
  await assert.rejects(hw.lockId(), /not one of this team's bays/);
  delete process.env.ECURIOUS_LOCK_ID;
  assert.equal((await hw.status()).state, 'unknown', 'a caller that names no lock gets none');
});

test('the server’s team list decides: lock-0001 is used once it is listed again (it came back at 16:30)', async () => {
  const calls = fake({ 'lock-0001': { ...lock2(), id: 'lock-0001' }, 'lock-0002': lock2() });
  assert.deepEqual(await hw.teamLocks(), ['lock-0001', 'lock-0002']);
  await hw.lower('lock-0001');
  assert.ok(calls.some((c) => c.path === '/locks/lock-0001/unlock'));
});

test('events keep each lock’s cached status current between reads', async () => {
  fake();
  await hw.status('lock-0002');
  await hw.status('lock-0003');
  hw.noteEvent({ type: 'arm', lockId: 'lock-0002', arm: 'lowered' });
  hw.noteEvent({ type: 'presence', lockId: 'lock-0002', presence: 'occupied' });
  hw.noteEvent({ type: 'alarm', lockId: 'lock-0002', error: 'water_ingress' });
  hw.noteEvent({ type: 'presence', lockId: 'lock-0003', presence: 'occupied' });
  hw.noteStream(true);
  const s = await hw.status('lock-0002');
  assert.deepEqual([s.state, s.carPresence, s.activeErrors, s.events], ['free', 'occupied', ['water_ingress'], true]);
  assert.deepEqual((await hw.status('lock-0003')).activeErrors, []);
});
