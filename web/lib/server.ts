import { timingSafeEqual } from 'node:crypto';
import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { baywatchBays, geBay, geIdOf, type BayInfo } from './bays';
import type { StateResponse, ViewerSummary, Wallet } from './booking-types';
import * as ecurious from './ecurious';
import { fail } from './errors';
import { chargerById, chargersNear } from './goingelectric';
import { legacyFacade, legacyState } from './legacy';
import { emailBlockedBay, operatorEmails } from './notify';
import { weekStats } from './operator';
import { settleBooking } from './payments';
import { createSchedule, type Schedule } from './schedule';

export const simulator = process.env.SIMULATOR === '1';
const holidays = (process.env.HOLIDAYS ?? '').split(',').map((d) => d.trim()).filter(Boolean); // YYYY-MM-DD, priced as busy

// Driver credit lives in their Clerk privateMetadata (creditCents, firstFree). updateUserMetadata merges, so the
// cars (vehicles.ts) and the Stripe customer id stay. A driver without the flag is new: the first booking is free.
const wallets = {
  async load(userId: string): Promise<Wallet> {
    const m = (await (await clerkClient()).users.getUser(userId)).privateMetadata;
    const credit = Number(m.creditCents);
    return { creditCents: Number.isInteger(credit) && credit > 0 ? credit : 0, firstFree: m.firstFree !== false };
  },
  async save(userId: string, w: Wallet) {
    await (await clerkClient()).users.updateUserMetadata(userId, { privateMetadata: { creditCents: w.creditCents, firstFree: w.firstFree } });
  },
};

// Re-routing candidates: the other Baywatch bays and GoingElectric chargers within 3 km (cached by fetch)
async function nearby(bay: BayInfo) {
  const found = (await chargersNear(bay.lat, bay.lng, 3)) ?? [];
  return [...schedule.realBays(), ...found.map(geBay)];
}

// Bump when the engine's shape changes, so a hot-reloading dev server starts a fresh one instead of keeping
// an old instance that lacks the new methods
const STORE = 'schedule_v1';
const g = globalThis as typeof globalThis & { [STORE]?: Schedule };

// One engine per process, shared by all route handlers and kept across dev reloads.
// ponytail: needs one long-running `next start` process; serverless instances would each get their own state.
export const schedule: Schedule = (g[STORE] ??= (() => {
  const s = createSchedule({
    bays: baywatchBays(),
    hw: { raise: ecurious.raise, lower: ecurious.lower, setPlates: ecurious.setPlates, status: ecurious.status },
    wallets,
    holidays,
    // email in the background; the alert shows the delivery status on the dashboard
    onAlert: (alert, bay) => void emailBlockedBay(alert.since, bay).then((st) => (alert.emailStatus = st)),
    // card payments (lib/payments.ts): a booking with a hold is settled for its receipt; demo bookings are skipped
    onEnd: (booking) => void settleBooking(booking),
    nearby,
  });
  setInterval(() => void s.tick(), 5_000);
  return s;
})());

// Live mode: the configured locks are checked against the team's (GET /locks) and any other one is dropped, so
// it's never called. true once checked (or in mock mode). The bridge retries until it succeeds.
export async function validateLocks() {
  if (!ecurious.live()) return true;
  try {
    schedule.dropLocks(await ecurious.teamLocks());
    return true;
  } catch (e) {
    console.warn(`[ecurious] the team's locks could not be read: ${(e as Error).message}`);
    return false;
  }
}
void validateLocks();

// A bay by id: a Baywatch bay, or a GoingElectric charger (looked up once, then remembered)
export async function resolveBay(id: string) {
  const known = schedule.bay(id);
  if (known) return known;
  const geId = geIdOf(id);
  const charger = geId === null ? null : await chargerById(geId);
  return charger ? schedule.knowBay(geBay(charger)) : fail(404, 'Unknown bay');
}

// Demo events (the demo panel) are refused for bays behind a real lock: they listen only to the real camera and
// sensor, so a faked plate can never move a real arm. With the hardware mocked there's no real arm to protect.
export function assertSimulated(bay: BayInfo) {
  if (bay.lockId && ecurious.live()) fail(403, `${bay.name} has a real lock: it only listens to its own camera and car sensor`);
}

// The hardware behind a bay, for the screens. A bay without a lock reports the guard it simulates.
export async function hardwareStatus(bayId: string = 'bw-1') {
  const lockId = schedule.bay(bayId)?.lockId;
  return lockId ? { online: true, ...(await ecurious.status(lockId)) } : { online: true, state: 'unknown' as const, mock: true };
}

async function viewerSummary(userId: string): Promise<ViewerSummary> {
  const { active, upcoming, creditCents, firstFree } = await schedule.bookingsOf(userId);
  return { active, next: upcoming[0] ?? null, creditCents, firstFree };
}

// GET /api/state: the v2 summary for the app shell, plus the fields the old screens read (legacy.ts) until they go
export async function appState(viewerId: string | null) {
  const v2: StateResponse = {
    simulator,
    demand: schedule.demand(),
    viewer: viewerId ? await viewerSummary(viewerId) : null,
    realBays: schedule.realBays().map(schedule.bayView),
  };
  return { ...v2, ...(await legacyState(schedule, viewerId, { simulator, hardware: await hardwareStatus() })) };
}
export type AppState = Awaited<ReturnType<typeof appState>>;

// The operator dashboard: every Baywatch bay with its hardware, the alerts (plates until resolved), the event
// log and the last 7 days
export async function operatorData() {
  const { records, alerts } = schedule.analytics();
  const bays = await Promise.all(schedule.realBays().map(async (b) => ({ ...schedule.operatorBay(b.id), hardware: await hardwareStatus(b.id) })));
  return { simulator, bays, alerts: schedule.alerts(), log: schedule.log(), stats: weekStats(records, alerts, Date.now()) };
}
export type OperatorData = Awaited<ReturnType<typeof operatorData>>;

// The old screens and the modules still on v1 names (deprecated; legacy.ts)
const legacy = legacyFacade(schedule, holidays);
export const { bay, holdMinutes, reservations } = legacy;

// Signed-in Clerk user, or 401. Session cookies (web) and Bearer session tokens (Flutter, later) both work.
export async function requireUser() {
  const { userId } = await auth();
  return userId ?? fail(401, 'Sign in to continue');
}

export const viewer = async () => (await auth()).userId ?? null;

// Operators are listed by email in OPERATOR_EMAILS
export async function isOperator() {
  const email = (await currentUser())?.primaryEmailAddress?.emailAddress.toLowerCase();
  return !!email && operatorEmails().includes(email);
}

export async function requireOperator() {
  const userId = await requireUser();
  if (!(await isOperator())) fail(403, 'Operators only');
  return userId;
}

// Camera events: 'in' (car entered the bay, the default) or 'out' (car left)
export const direction = (v: unknown): 'in' | 'out' =>
  v === undefined || v === 'in' ? 'in' : v === 'out' ? 'out' : fail(400, 'direction must be "in" or "out"');

// Fails closed: no secret configured means nobody can send plate events (a matching plate opens the bay)
export function secretOk(got: string | null) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return false;
  const a = Buffer.from(got ?? '');
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  // read in chunks and stop at the limit, so a huge body is never buffered
  let s = '';
  const decoder = new TextDecoder();
  const reader = req.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    s += decoder.decode(value, { stream: true });
    if (s.length > 10_000) {
      await reader.cancel();
      fail(413, 'Request body too large');
    }
  }
  try {
    return JSON.parse(s || '{}');
  } catch {
    return fail(400, 'Invalid JSON');
  }
}

// Turns thrown errors into JSON responses with their status
export async function handle(fn: () => unknown) {
  try {
    return Response.json(await fn());
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) console.error(e);
    return Response.json({ error: (e as Error).message }, { status: status ?? 500 });
  }
}
