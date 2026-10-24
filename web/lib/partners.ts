// Partner API: other charging apps (eMSPs) reserve the Ecurious bay for their own drivers.
// OCPI 2.2.1-style RESERVE_NOW / CANCEL_RESERVATION, answered synchronously in the OCPI envelope, plus a
// status endpoint to poll. The partner passes the driver's plate (with the driver's consent), so the camera
// checks that car in like any other booking. Guide: docs/api.md · spec: public/openapi.json.
// No Next.js imports, so `node --test lib/partners.test.ts` runs it as it is.

import { createHash, timingSafeEqual } from 'node:crypto';
import { formatEuro } from './pricing.ts';
import type { createReservations, ReservationView } from './reservation.ts';

// OCPI location_id of the bay. One guarded bay (one EVSE) per location today; with more bays, evse_uid picks one.
export const bayId = process.env.BAY_ID ?? 'ECU-TEST-1';
export const evseUid = `${bayId}-1`;

// The deep link for "Reserve with Ecurious" buttons: the bay in the app, with the reserve dialog open
export const reserveLink = (id = bayId) => `/explore?bay=${encodeURIComponent(id)}&reserve=1`;

export type Partner = { name: string; token: string };
type Link = { reservationId: string; ownerId: string; id: string };
type Windows = Map<string, { start: number; count: number }>;
export type Reply = { status: number; body: { data?: unknown; status_code: number; status_message: string; timestamp: string } };

const g = globalThis as typeof globalThis & { ecuriousPartnerLinks?: Map<string, Link>; ecuriousPartnerWindows?: Windows };

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

// ── Auth ──────────────────────────────────────────────────────────────────────────────────────────

// OCPI_PARTNER_TOKENS=acme:<token>,beta:<token>. A name may appear twice, to rotate its token.
// Entries without a lowercase name or with a token under 32 characters are skipped: no valid entry, no access.
export function parsePartnerTokens(env: string | undefined): Partner[] {
  return (env ?? '').split(',').flatMap((entry) => {
    const i = entry.indexOf(':');
    const name = entry.slice(0, i).trim();
    const token = entry.slice(i + 1).trim();
    if (i > 0 && /^[a-z0-9-]{1,32}$/.test(name) && token.length >= 32) return [{ name, token }];
    if (entry.trim()) console.warn('OCPI_PARTNER_TOKENS: skipped an entry. Use name:token, a lowercase name and a token of 32+ characters.');
    return [];
  });
}

let configured: { env: string | undefined; partners: Partner[] } | undefined;
const partners = () => {
  const env = process.env.OCPI_PARTNER_TOKENS;
  if (!configured || configured.env !== env) configured = { env, partners: parsePartnerTokens(env) };
  return configured.partners;
};

const digest = (s: string) => createHash('sha256').update(s).digest();

// `Authorization: Token <token>`. OCPI 2.2.1 Base64-encodes the token, many clients send it plain: both count.
// Digests have equal lengths, so timingSafeEqual compares in constant time, and every entry is checked.
export function partnerFor(header: string | null, list: Partner[]): string | null {
  const sent = /^Token\s+(\S+)$/i.exec(header?.trim() ?? '')?.[1];
  if (!sent) return null;
  const candidates = [digest(sent), digest(Buffer.from(sent, 'base64').toString('utf8'))];
  let found: string | null = null;
  for (const p of list) {
    const want = digest(p.token);
    for (const c of candidates) if (timingSafeEqual(c, want)) found ??= p.name;
  }
  return found;
}

const WINDOW_MS = 60_000;
export const MAX_REQUESTS = 60; // per partner and minute, commands and status polls together

// Seconds until the partner may call again; 0 = go ahead.
// ponytail: fixed window in memory, one process. Move it to the API gateway (or Redis) with more instances.
export function retryAfter(partner: string, now = Date.now(), windows: Windows = (g.ecuriousPartnerWindows ??= new Map())) {
  const w = windows.get(partner);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(partner, { start: now, count: 1 });
    return 0;
  }
  return ++w.count > MAX_REQUESTS ? Math.ceil((w.start + WINDOW_MS - now) / 1000) : 0;
}

// ── OCPI answers ──────────────────────────────────────────────────────────────────────────────────

// OCPI's response envelope, for every partner endpoint
export const envelope = (data: unknown, status_code = 1000, status_message = 'Success'): Reply['body'] => ({
  ...(data === undefined ? {} : { data }),
  status_code,
  status_message,
  timestamp: new Date().toISOString(),
});

// CommandResponse. Our answer is final, no CommandResult callback follows: hence timeout 0.
export const commandResponse = (result: 'ACCEPTED' | 'REJECTED' | 'NOT_SUPPORTED', text: string, extra: object = {}) => ({
  result,
  timeout: 0,
  message: [{ language: 'en', text }],
  ...extra,
});

// A 502 comes from the bay's hardware. If it said no for a reason (a car over the arm, the bay offline, a
// command that just failed), that reason is the answer; if it didn't answer (a timeout, a dropped connection),
// null: the caller sends a generic text. Our REST paths, the API key and device serials stay on the server,
// and the engine's hardware messages never carry plates.
const NO_ANSWER = /no answer in \d+ s|\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|UND_ERR_\w+)\b|fetch failed/;
function hardwareReason(text: string) {
  if (NO_ANSWER.test(text)) return null;
  const key = process.env.ECURIOUS_API_KEY;
  return (key ? text.split(key).join('[key]') : text).replace(/\b(GET|POST) \/\S+: /g, '').replace(/\b[0-9a-f]{12,}\b/gi, '[serial]');
}

// Thrown errors as OCPI answers. A refusal (bay taken, unknown id, price moved, the hardware saying no) is a
// normal REJECTED with its reason; a malformed request is 400/413; our own failures and hardware that doesn't
// answer are 5xx with a generic message, and logged here.
export function commandError(e: unknown): Reply {
  const status = (e as { status?: unknown } | null)?.status;
  const text = e instanceof Error ? e.message : String(e);
  if (status === 400 || status === 413) return { status, body: envelope(commandResponse('REJECTED', text), 2001, 'Invalid or missing parameters') };
  if (typeof status === 'number' && status < 500) return { status: 200, body: envelope(commandResponse('REJECTED', text)) };
  console.error('Partner command failed:', e);
  const reason = status === 502 ? hardwareReason(text) : null;
  if (reason) return { status: 200, body: envelope(commandResponse('REJECTED', reason)) };
  const hw = status === 502;
  return {
    status: hw ? 502 : 500,
    body: envelope(
      commandResponse('REJECTED', hw ? 'The bay’s hardware did not respond. Try again in a minute.' : 'Internal error'),
      3000,
      hw ? 'Hardware not reachable' : 'Internal error',
    ),
  };
}

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sameId = (a: string, b: string) => a.toUpperCase() === b.toUpperCase(); // OCPI CiString: case-insensitive
const iso = (t: number) => new Date(t).toISOString();
const TOKEN_TYPES = ['AD_HOC_USER', 'APP_USER', 'OTHER', 'RFID'];
const LIVE = ['reserved', 'arrived', 'charging'];

// OCPI CiString(36): printable ASCII. Spaces aren't allowed in ids here.
function ciString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[\x21-\x7e]{1,36}$/.test(v)) fail(400, `${field} must be 1 to 36 printable ASCII characters`);
  return v;
}

// response_url is where OCPI would POST the async CommandResult. Checked, never called: we don't make
// requests to partner-supplied URLs. Our answer is final, and the status endpoint is there to poll.
function checkResponseUrl(v: unknown) {
  if (v !== undefined && (typeof v !== 'string' || v.length > 255)) fail(400, 'response_url must be a URL of up to 255 characters');
}

function reserveInput(b: unknown, now: number) {
  if (!isObject(b)) fail(400, 'Send a ReserveNow JSON object');
  checkResponseUrl(b.response_url);
  const t = b.token;
  if (!isObject(t)) fail(400, 'token is required (an OCPI Token object)');
  const uid = ciString(t.uid, 'token.uid');
  ciString(t.contract_id, 'token.contract_id'); // required by OCPI, not stored
  if (typeof t.type !== 'string' || !TOKEN_TYPES.includes(t.type)) fail(400, `token.type must be one of ${TOKEN_TYPES.join(', ')}`);
  if (t.valid !== undefined && typeof t.valid !== 'boolean') fail(400, 'token.valid must be true or false');
  const reservationId = ciString(b.reservation_id, 'reservation_id');
  const location = ciString(b.location_id, 'location_id');
  const evse = b.evse_uid === undefined ? undefined : ciString(b.evse_uid, 'evse_uid');
  if (b.authorization_reference !== undefined) ciString(b.authorization_reference, 'authorization_reference');
  const expiry = typeof b.expiry_date === 'string' && b.expiry_date.length <= 40 ? Date.parse(b.expiry_date) : NaN;
  if (!Number.isFinite(expiry)) fail(400, 'expiry_date must be an RFC 3339 date-time, e.g. 2026-10-24T12:30:00Z');
  const plate = b.ecurious_license_plate;
  if (typeof plate !== 'string' || plate.length > 20) fail(400, 'ecurious_license_plate is required: the plate the camera will read');
  if (b.ecurious_plate_consent !== true) fail(400, 'ecurious_plate_consent must be true: the driver agreed to plate recognition for this booking');
  const minutes = b.ecurious_session_minutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) fail(400, 'ecurious_session_minutes must be a whole number of minutes');
  const fee = b.ecurious_fee_cents;
  if (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0) fail(400, 'ecurious_fee_cents must be the fee the driver accepted, in cents (quote.cents from GET /api/state)');
  // the request is well-formed; from here on a "no" is a REJECTED
  if (!sameId(location, bayId)) fail(404, `Unknown location_id. This server has ${bayId}.`);
  if (evse !== undefined && !sameId(evse, evseUid)) fail(404, `Unknown evse_uid. Location ${bayId} has ${evseUid}.`);
  if (t.valid === false) fail(403, 'The token is not valid');
  if (expiry <= now) fail(409, 'expiry_date has already passed');
  return { uid, reservationId, plate, minutes, fee };
}

// ── Reservations ──────────────────────────────────────────────────────────────────────────────────

type Reservations = Pick<ReturnType<typeof createReservations>, 'reserve' | 'cancel' | 'state' | 'bookings'>;

// The one adapter between partners and reservation.ts, whose API teammates are still changing: every call
// to it goes through here. `links` maps a partner's reservation_id to our reservation.
export function partnerBay(r: Reservations, links: Map<string, Link> = (g.ecuriousPartnerLinks ??= new Map())) {
  return {
    links,
    reserve: (ownerId: string, plate: string, label: string, minutes: number, feeCents: number) =>
      r.reserve(ownerId, plate, label, minutes * 60_000, feeCents),
    cancel: (ownerId: string) => r.cancel(ownerId),
    // a reservation, current or ended, as its owner sees it
    find: (ownerId: string, id: string): ReservationView | null =>
      [r.state(ownerId).reservation, ...r.bookings(ownerId)].find((v) => v?.id === id) ?? null,
    // what anyone may know: is the bay free, and what does it cost right now
    availability: () => {
      const s = r.state(null);
      const status = s.blockedSince ? 'occupied' : s.reservation ? (s.reservation.status === 'reserved' ? 'reserved' : 'in_use') : s.priority ? 'held' : 'free';
      return { status: status as 'free' | 'reserved' | 'in_use' | 'occupied' | 'held', feeCents: s.quote.cents, demand: s.quote.demand };
    },
  };
}
export type PartnerBay = ReturnType<typeof partnerBay>;

const LINKS_CAP = 500;
const linkKey = (partner: string, reservationId: string) => `${partner}\n${reservationId.toUpperCase()}`;

const accepted = (v: ReservationView, text: string) =>
  commandResponse('ACCEPTED', text, { ecurious_arrive_by: iso(v.expiresAt), ecurious_fee_cents: v.feeCents ?? null });

async function reserveNow(partner: string, input: unknown, bay: PartnerBay) {
  const req = reserveInput(input, Date.now());
  const key = linkKey(partner, req.reservationId);
  const known = bay.links.get(key);
  if (known) {
    // a retry after a lost answer: same result, nothing changes (OCPI's "replace" isn't supported)
    const v = bay.find(known.ownerId, known.id);
    if (!v || !LIVE.includes(v.status)) fail(409, 'This reservation_id was already used. Send a new one.');
    return accepted(v, `Already reserved under this reservation_id; nothing was changed. Arrive by ${iso(v.expiresAt)}.`);
  }
  const ownerId = `partner:${partner}:${req.uid.toUpperCase()}`;
  const v = await bay.reserve(ownerId, req.plate, `Booked via ${partner}`, req.minutes, req.fee);
  bay.links.set(key, { reservationId: req.reservationId, ownerId, id: v.id });
  // ponytail: in memory like the reservations, oldest link dropped past the cap. A table once there's a DB.
  if (bay.links.size > LINKS_CAP) bay.links.delete(bay.links.keys().next().value!);
  return accepted(v, `Reserved. Arrive by ${iso(v.expiresAt)}: the camera checks the car in by its plate.`);
}

// A partner can only cancel its own reservations: the lookup is keyed by partner
async function cancelReservation(partner: string, input: unknown, bay: PartnerBay) {
  if (!isObject(input)) fail(400, 'Send a CancelReservation JSON object');
  checkResponseUrl(input.response_url);
  const known = bay.links.get(linkKey(partner, ciString(input.reservation_id, 'reservation_id')));
  const v = known && bay.find(known.ownerId, known.id);
  if (!known || !v) fail(404, 'Unknown reservation_id');
  if (v.status === 'arrived' || v.status === 'charging') fail(409, 'The driver has already checked in. The session ends when the car leaves.');
  if (v.status !== 'reserved') fail(409, `This reservation has already ended (${v.status.toUpperCase()})`);
  const after = await bay.cancel(known.ownerId);
  const fee = after.totalCents ?? 0;
  return commandResponse('ACCEPTED', `Cancelled, the bay is free again. ${fee ? `Cancellation fee: ${formatEuro(fee)}.` : 'No fee.'}`, {
    ecurious_fee_cents: fee,
  });
}

// POST /ocpi/2.2.1/commands/{command}. Never throws: every outcome is an OCPI answer.
export async function runCommand(partner: string, command: string, read: () => Promise<unknown>, bay: PartnerBay): Promise<Reply> {
  try {
    const name = command.toUpperCase();
    if (name === 'RESERVE_NOW') return { status: 200, body: envelope(await reserveNow(partner, await read(), bay)) };
    if (name === 'CANCEL_RESERVATION') return { status: 200, body: envelope(await cancelReservation(partner, await read(), bay)) };
    return { status: 200, body: envelope(commandResponse('NOT_SUPPORTED', 'This server supports RESERVE_NOW and CANCEL_RESERVATION')) };
  } catch (e) {
    return commandError(e);
  }
}

// GET /api/partner/v1/reservations/{reservation_id}: the polling alternative to OCPI's CommandResult callbacks
export function reservationStatus(partner: string, reservationId: string, bay: PartnerBay): Reply {
  const known = /^[\x21-\x7e]{1,36}$/.test(reservationId) ? bay.links.get(linkKey(partner, reservationId)) : undefined;
  const v = known && bay.find(known.ownerId, known.id);
  if (!known || !v) return { status: 404, body: envelope(undefined, 2000, 'Unknown reservation_id') };
  return {
    status: 200,
    body: envelope({
      reservation_id: known.reservationId,
      location_id: bayId,
      evse_uid: evseUid,
      status: v.status.toUpperCase(), // RESERVED → ARRIVED → CHARGING → COMPLETED, or CANCELLED / NO_SHOW
      arrive_by: iso(v.expiresAt), // the hold: moves while another car blocks the bay, and with an extension
      session_end: iso(v.end),
      bay_blocked: v.blockedSince != null, // another car is in the bay: the hold is paused, cancelling is free
      license_plate_hint: v.plateHint ?? null, // masked; the plate itself is erased when the reservation ends
      checked_in_at: v.arrivedAt ? iso(v.arrivedAt) : null,
      ended_at: v.endedAt ? iso(v.endedAt) : null,
      fees: {
        currency: 'EUR',
        reservation_cents: v.feeCents ?? null,
        prepaid: v.prepaid ?? false,
        total_cents: v.totalCents ?? 0, // what this booking costs so far, refunds included
        lines: (v.charges ?? []).map(({ label, cents }) => ({ label, cents })),
      },
    }),
  };
}

// Every partner endpoint: token check (401, fails closed), rate limit (429), then the handler
export async function partnerRoute(req: Request, fn: (partner: string) => Promise<Reply> | Reply): Promise<Response> {
  const partner = partnerFor(req.headers.get('authorization'), partners());
  if (!partner) return Response.json(envelope(undefined, 2000, 'Missing or unknown token'), { status: 401, headers: { 'WWW-Authenticate': 'Token' } });
  const wait = retryAfter(partner);
  if (wait) return Response.json(envelope(undefined, 2000, `Too many requests. Try again in ${wait} s.`), { status: 429, headers: { 'Retry-After': String(wait) } });
  try {
    const { status, body } = await fn(partner);
    return Response.json(body, { status });
  } catch (e) {
    console.error('Partner request failed:', e);
    return Response.json(envelope(undefined, 3000, 'Internal error'), { status: 500 });
  }
}
