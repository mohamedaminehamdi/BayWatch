import { timingSafeEqual } from 'node:crypto';
import { auth, currentUser } from '@clerk/nextjs/server';
import { ARRIVAL_GRACE_MS, TYPES, type ReservationType } from './booking-rules';
import * as ecurious from './ecurious';
import { emailBlockedBay, operatorEmails } from './notify';
import { weekStats } from './operator';
import { createReservations, fail, type Direction } from './reservation';

export const simulator = process.env.SIMULATOR === '1';
export const bay = {
  name: process.env.BAY_NAME ?? 'Ecurious test bay',
  address: process.env.BAY_ADDRESS ?? 'Hackathon venue',
  lat: Number(process.env.BAY_LAT ?? 52.52),
  lng: Number(process.env.BAY_LNG ?? 13.405),
  powerKw: Number(process.env.BAY_POWER_KW ?? 200),
};

// fast (DC, sessions up to 2 h) or slow (AC, up to 4 h): from the charger's power unless BAY_TYPE says otherwise
const typeEnv = process.env.BAY_TYPE;
export const bayType: ReservationType = typeEnv === 'fast' || typeEnv === 'slow' ? typeEnv : bay.powerKw >= 50 ? 'fast' : 'slow';

// HOLD_MINUTES overrides the 15-min arrival grace, for short demo holds (fractions allowed: 0.5 = 30 s)
const holdOverrideMs = process.env.HOLD_MINUTES ? Number(process.env.HOLD_MINUTES) * 60_000 : undefined;
export const holdMinutes = (holdOverrideMs ?? ARRIVAL_GRACE_MS) / 60_000;

// Session lengths offered, in minutes, all within the type's maximum. The demo adds a 16-min session,
// so the reminder 15 min before the end shows up a minute after checking in.
export const sessionPresets = [...(bayType === 'fast' ? [30, 60, 90, 120] : [60, 120, 180, 240]), ...(simulator ? [16] : [])].sort((a, b) => a - b);

// "Site demand" in the demo panel: the share of the site in use, which sets the price tier
export const DEMAND_LEVELS = { quiet: 0.15, normal: 0.5, busy: 0.8, full: 0.95 };

type Reservations = ReturnType<typeof createReservations>;
// Bump when the store's shape changes, so a hot-reloading dev server starts a fresh store instead of
// keeping an old instance that lacks the new methods
const STORE = 'reservations_v2';
const g = globalThis as typeof globalThis & { [STORE]?: Reservations };

// One instance per process, shared by all route handlers and kept across dev reloads.
// ponytail: needs one long-running `next start` process; serverless instances would each get their own state.
export const reservations: Reservations = (g[STORE] ??= (() => {
  const r = createReservations({
    hw: ecurious,
    type: bayType,
    holdMs: holdOverrideMs,
    bay,
    // email in the background; the alert shows the delivery status on the dashboard
    onAlert: (alert) => void emailBlockedBay(alert.since, bay).then((s) => (alert.emailStatus = s)),
  });
  setInterval(r.expire, 5_000);
  return r;
})());

export async function appState(viewerId: string | null) {
  return {
    bay,
    session: { type: bayType, label: TYPES[bayType].label, maxMinutes: TYPES[bayType].maxMs / 60_000, presets: sessionPresets },
    holdMinutes,
    simulator,
    hardware: await ecurious.status(),
    ...reservations.state(viewerId),
  };
}
export type AppState = Awaited<ReturnType<typeof appState>>;

// The operator dashboard: live bay, alerts (plates until resolved), event log and the last 7 days
export async function operatorData() {
  const { records, alerts } = reservations.analytics();
  return { bay, simulator, hardware: await ecurious.status(), ...reservations.operatorState(), stats: weekStats(records, alerts, Date.now()) };
}
export type OperatorData = Awaited<ReturnType<typeof operatorData>>;

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
export const direction = (v: unknown): Direction =>
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
