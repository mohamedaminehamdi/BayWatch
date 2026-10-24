// Ecurious hardware adapter for the test bay: a Chang Cheng CC5S ground lock (barrier arm, car sensor and
// plate camera) behind the Ecurious server. reserve() raises the arm for the booked driver, release() lowers
// it and keeps it down, status() reads the arm, the car sensor and the device's health, cached for a few
// seconds. The mapping and the reasons for it are in docs/hardware-integration.md.
//
// Live only with ECURIOUS_API_KEY *and* ECURIOUS_LIVE=1, and ECURIOUS_MOCK=1 always forces the mock: the key
// sits in .env, and a dev server must never move the real arm unless someone opted in.
import type { HwEvent } from './ecurious-events.ts';

const BASE = 'https://parking-lock-service-production.up.railway.app/api/v1';
const READ_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 8_000; // a command crosses the server's TCP gateway and the device's 4G link
const READ_BACKOFF_MS = [300, 1_000]; // reads retry twice; writes never: the arm may already be moving
const STATUS_TTL_MS = 5_000; // every client polls /api/state every 2 s: read the hardware at most every 5 s
const WRITE_COOLDOWN_MS = 30_000; // after a failed command, refuse new ones for a while instead of looping

// A bay as GET /api/v1/locks returns it
export type Lock = {
  id: string;
  name?: string;
  status?: string; // 'raised' | 'lowered' | 'offline' (offline isn't in the docs, but real)
  carPresence?: string; // 'occupied' | 'vacant'
  deviceStatusRaw?: number; // 1 raised, 2 lowered: the last position an offline lock reported
  battery12V?: number;
  battery3_7V?: number;
  signalStrength4G?: number;
  waterIngress?: boolean;
  activeErrors?: string[];
  lastSeenAt?: string;
  whitelist?: string[]; // plates the camera lowers the arm for by itself; ['*'] = any car
};

// `hardware` in /api/state and /api/operator. The mock only sets `state` and `mock`. Never holds a plate.
export type HardwareStatus = {
  state: 'free' | 'blocked' | 'unknown'; // arm down, arm up, not read yet
  mock: boolean;
  lockId?: string;
  name?: string;
  online?: boolean;
  carPresence?: 'occupied' | 'vacant' | null;
  autoUnlock?: 'any' | 'plates' | 'off' | null; // whom the camera lowers the arm for: 'any' = the hold isn't enforced
  battery12V?: number | null;
  battery3_7V?: number | null;
  signalStrength4G?: number | null;
  waterIngress?: boolean | null;
  activeErrors?: string[];
  lastSeenAt?: string | null;
  events?: boolean; // the live event stream is connected
  stale?: boolean; // the last read failed: the values are from `updatedAt`
  error?: string;
  updatedAt?: number | null;
};

type Cache = {
  lockId?: string;
  lock?: Lock;
  okAt: number; // last successful read
  triedAt: number; // last read attempt
  reading?: Promise<void>;
  error?: string;
  events: boolean;
  failedAt: number; // last failed command
  mock: 'free' | 'blocked';
};

// On globalThis: instrumentation.ts (the event bridge) and the route handlers are bundled separately, so each
// gets its own copy of this module, and they must share one cache. Bump the key if the shape changes.
const g = globalThis as typeof globalThis & { ecurious_v1?: Cache };
const cache = () => (g.ecurious_v1 ??= { okAt: 0, triedAt: 0, events: false, failedAt: 0, mock: 'free' });

export const live = () =>
  !!process.env.ECURIOUS_API_KEY && process.env.ECURIOUS_LIVE === '1' && process.env.ECURIOUS_MOCK !== '1';

const key = () => process.env.ECURIOUS_API_KEY ?? '';

// The key never reaches an error message or a log, even if the server echoes it
const hwError = (message: string, httpStatus?: number) =>
  Object.assign(new Error(key() ? message.split(key()).join('[key]') : message), { httpStatus });

// One REST call: the key in a header (never in the URL), a timeout, reads retried with backoff
export async function call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const read = method === 'GET';
  const timeout = read ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    let err: Error & { httpStatus?: number };
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'x-api-key': key(), accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; message?: string };
      if (res.ok && data.success !== false) return data as T;
      err = hwError(`${method} ${path}: ${data.error ?? data.message ?? `HTTP ${res.status}`}`, res.status);
    } catch (e) {
      const { name, message, cause } = e as Error & { cause?: { code?: string } };
      err = hwError(`${method} ${path}: ${name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : (cause?.code ?? message)}`);
    }
    const transient = err.httpStatus === undefined || err.httpStatus === 429 || err.httpStatus >= 500;
    if (!read || !transient || attempt >= READ_BACKOFF_MS.length) throw err;
    await new Promise((r) => setTimeout(r, READ_BACKOFF_MS[attempt]));
  }
}

// The live event stream (see ecurious-events.ts). The header works there too, so the key stays out of URLs.
export const openEvents = (signal: AbortSignal) =>
  fetch(`${BASE}/events`, { headers: { 'x-api-key': key(), accept: 'text/event-stream' }, signal });

// ECURIOUS_LOCK_ID, else the team's first bay. Either way it must be one of the team's own bays (fair play).
export async function lockId() {
  const c = cache();
  if (c.lockId) return c.lockId;
  const { locks = [] } = await call<{ locks?: Lock[] }>('GET', '/locks');
  const want = process.env.ECURIOUS_LOCK_ID || locks[0]?.id;
  const lock = locks.find((l) => l.id === want);
  if (!lock) throw hwError(want ? `${want} is not one of this team's bays` : 'No bays are assigned to this team');
  if (!process.env.ECURIOUS_LOCK_ID) console.warn(`[ecurious] ECURIOUS_LOCK_ID unset: using the team's first bay, ${lock.id}`);
  Object.assign(c, { lockId: lock.id, lock, okAt: Date.now() });
  return lock.id;
}

const lockPath = async () => `/locks/${encodeURIComponent(await lockId())}`;

async function read() {
  const c = cache();
  try {
    const { lock } = await call<{ lock: Lock }>('GET', await lockPath());
    Object.assign(c, { lock, okAt: Date.now(), error: undefined });
  } catch (e) {
    c.error = (e as Error).message;
    throw e;
  } finally {
    c.triedAt = Date.now(); // a failing service is tried again 5 s after the last attempt ended, not in a loop
  }
}

const ARM_RAW: Record<number, string> = { 1: 'raised', 2: 'lowered' };

function view(c: Cache): HardwareStatus {
  const l = c.lock;
  const arm = l?.status === 'offline' ? ARM_RAW[l.deviceStatusRaw ?? 0] : l?.status;
  const wl = l?.whitelist;
  return {
    state: arm === 'raised' ? 'blocked' : arm === 'lowered' ? 'free' : 'unknown',
    mock: false,
    lockId: c.lockId,
    name: l?.name,
    online: !!l && l.status !== 'offline',
    carPresence: l?.carPresence === 'occupied' || l?.carPresence === 'vacant' ? l.carPresence : null,
    autoUnlock: !wl ? null : wl.includes('*') ? 'any' : wl.length ? 'plates' : 'off',
    battery12V: l?.battery12V ?? null,
    battery3_7V: l?.battery3_7V ?? null,
    signalStrength4G: l?.signalStrength4G ?? null,
    waterIngress: l?.waterIngress ?? null,
    activeErrors: l?.activeErrors ?? [],
    lastSeenAt: l?.lastSeenAt ?? null,
    events: c.events,
    stale: !!c.error,
    error: c.error,
    updatedAt: c.okAt || null,
  };
}

// Never throws and never waits on the hardware once it has been read: a stale value is served while it
// re-reads in the background, and events (noteEvent) keep it current in between
export async function status(): Promise<HardwareStatus> {
  const c = cache();
  if (!live()) return { state: c.mock, mock: true };
  if (!c.reading && Date.now() - c.triedAt > STATUS_TTL_MS) {
    c.reading = read()
      .catch(() => {})
      .finally(() => (c.reading = undefined));
  }
  if (!c.lock) await c.reading;
  return view(c);
}

// Raise the arm and keep it up for the booked driver. `plates` (the booked car) go on the camera's list when
// ECURIOUS_WHITELIST=1. Refuses an offline bay, and never raises the arm under a car.
export async function reserve(plates: string[] = []) {
  if (!live()) return void (cache().mock = 'blocked');
  await read(); // fresh, not cached: this decides whether the arm may go up
  const l = cache().lock!;
  if (l.status === 'offline') throw hwError(`${l.name ?? l.id} is offline (last seen ${l.lastSeenAt ?? 'never'})`);
  if (l.carPresence !== 'vacant') throw hwError('A car is over the arm, so it was not raised');
  await command('lock', 'raised');
  // during a hold the camera may lower the arm for the booked car only, or for nobody: never for any car
  await setAutoUnlock(process.env.ECURIOUS_WHITELIST === '1' ? plates : []);
}

// Lower the arm and keep it down (cancelAutoLift): it must not rise again under the car, nor after the car
// leaves, when the bay is open to anyone
export async function release() {
  if (!live()) return void (cache().mock = 'free');
  await command('unlock', 'lowered');
  await setAutoUnlock([]);
}

async function command(action: 'lock' | 'unlock', arm: 'raised' | 'lowered') {
  const c = cache();
  const wait = c.failedAt + WRITE_COOLDOWN_MS - Date.now();
  if (wait > 0) throw hwError(`The last bay command failed, try again in ${Math.ceil(wait / 1000)} s`);
  try {
    await call('POST', `${await lockPath()}/${action}`, { cancelAutoLift: true });
  } catch (e) {
    c.failedAt = Date.now();
    c.triedAt = 0; // it may have moved anyway: re-read on the next status()
    throw e;
  }
  if (c.lock) c.lock.status = arm; // the status_change event and the next read confirm it
}

// The camera's own plate list (it lowers the arm itself for these). Best effort: if it fails, our own
// plate match still checks the driver in, and status() shows autoUnlock so the operator sees it.
async function setAutoUnlock(plates: string[]) {
  const c = cache();
  const now = c.lock?.whitelist;
  if (now && now.length === plates.length && plates.every((p) => now.includes(p))) return;
  try {
    const res = await call<{ whitelist?: string[] }>('POST', `${await lockPath()}/whitelist`, { plates });
    if (c.lock) c.lock.whitelist = res.whitelist ?? plates;
    if (plates.some((p) => !res.whitelist?.includes(p))) console.warn('[ecurious] the camera did not store every plate sent');
  } catch (e) {
    c.triedAt = 0;
    console.warn(`[ecurious] camera plate list not updated: ${(e as Error).message}`);
  }
}

// From the event bridge: keeps the cached status current between reads
export function noteEvent(e: HwEvent) {
  const c = cache();
  const l = c.lock;
  if (!l || e.lockId !== l.id) return;
  if (e.type === 'arm') l.status = e.arm;
  if (e.type === 'presence') l.carPresence = e.presence;
  if (e.type === 'alarm') l.activeErrors = [...new Set([...(l.activeErrors ?? []), e.error])];
  if (l.status === 'offline') c.triedAt = 0; // it's talking again: re-read on the next status()
  l.lastSeenAt = new Date().toISOString();
}

export const noteStream = (up: boolean) => void (cache().events = up);
