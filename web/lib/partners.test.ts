import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bayId,
  commandError,
  envelope,
  evseUid,
  MAX_REQUESTS,
  parsePartnerTokens,
  partnerBay,
  partnerFor,
  partnerRoute,
  reservationStatus,
  retryAfter,
  runCommand,
} from './partners.ts';
import { createReservations } from './reservation.ts';

const ACME = 'acme-token-0123456789abcdef0123456789';
const BETA = 'beta-token-0123456789abcdef0123456789';
const MIN = 60_000;

// The code under test logs the failures these tests provoke on purpose; keep the output readable
async function muted<T>(fn: () => T | Promise<T>): Promise<T> {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, warn });
  }
}

// A real reservation lifecycle (fast DC bay) with fake hardware, behind the partner adapter
function setup() {
  const calls: string[] = [];
  const hw = { reserve: async () => void calls.push('reserve'), release: async () => void calls.push('release') };
  const r = createReservations({ hw, bay: { lat: 52.52, lng: 13.405 }, type: 'fast' });
  const bay = partnerBay(r, new Map());
  const fee = r.quote(null).cents;
  const send = async (partner: string, command: string, input: unknown) => {
    const { status, body } = await runCommand(partner, command, async () => input, bay);
    const data = body.data as { result: string; timeout: number; message: { text: string }[]; [k: string]: unknown };
    return { status, code: body.status_code, data, text: data?.message[0].text ?? '' };
  };
  const token = { country_code: 'DE', party_id: 'ACM', uid: 'drv-123', type: 'APP_USER', contract_id: 'DE-ACM-C12345678-9', issuer: 'Acme', valid: true };
  const reserveNow = (over: Record<string, unknown> = {}) => ({
    response_url: 'https://emsp.example/ocpi/2.2.1/commands/RESERVE_NOW/42',
    token,
    expiry_date: new Date(Date.now() + 15 * MIN).toISOString(),
    reservation_id: 'R-1',
    location_id: bayId,
    evse_uid: evseUid,
    ecurious_license_plate: 'M-AB 1234',
    ecurious_plate_consent: true,
    ecurious_session_minutes: 60,
    ecurious_fee_cents: fee,
    ...over,
  });
  const status = (partner: string, id: string) => {
    const { status, body } = reservationStatus(partner, id, bay);
    return { status, data: body.data as Record<string, unknown> & { fees: { total_cents: number; lines: unknown[] } } };
  };
  return { r, calls, fee, token, send, reserveNow, status };
}

test('partner tokens come from OCPI_PARTNER_TOKENS; bad entries are skipped, and nothing set lets nobody in', async () => {
  const list = await muted(() =>
    parsePartnerTokens(` acme:${ACME} , beta:${BETA},Upper:${ACME},short:abc,nocolon${ACME},:${ACME},acme:${ACME}-rotated`),
  );
  assert.deepEqual(
    list.map((p) => p.name),
    ['acme', 'beta', 'acme'],
    'a name may appear twice, to rotate its token',
  );
  assert.equal(list[0].token, ACME, 'spaces around entries are trimmed');
  assert.deepEqual(parsePartnerTokens(undefined), []);
  assert.deepEqual(parsePartnerTokens(''), []);
});

test('token check: plain or Base64 (OCPI 2.2.1), compared as digests; wrong, partial or missing tokens get nobody', () => {
  const list = [
    { name: 'acme', token: ACME },
    { name: 'beta', token: BETA },
  ];
  assert.equal(partnerFor(`Token ${ACME}`, list), 'acme');
  assert.equal(partnerFor(`Token ${Buffer.from(BETA).toString('base64')}`, list), 'beta', 'OCPI 2.2.1 sends the token Base64-encoded');
  assert.equal(partnerFor(`token   ${ACME}`, list), 'acme', 'the scheme is case-insensitive');
  const rejected = [null, '', ACME, `Bearer ${ACME}`, `Token ${ACME.slice(0, -1)}`, `Token ${ACME}x`, 'Token', `Token ${ACME} ${BETA}`];
  for (const h of rejected) assert.equal(partnerFor(h, list), null, `rejects ${JSON.stringify(h)}`);
  assert.equal(partnerFor('Token a', list), null, 'a 1-character token compares without throwing: digests have equal lengths');
  assert.equal(partnerFor(`Token ${ACME}`, []), null, 'no partners configured: fails closed');
});

test('RESERVE_NOW: every field is checked; malformed is 400, a "no" is REJECTED with the reason', async () => {
  const { send, reserveNow, token, calls } = setup();
  const cases: [string, unknown, number, RegExp][] = [
    ['not an object', [], 400, /JSON object/],
    ['no token', reserveNow({ token: undefined }), 400, /token is required/],
    ['token.uid too long', reserveNow({ token: { ...token, uid: 'x'.repeat(37) } }), 400, /token\.uid/],
    ['token.uid with a space', reserveNow({ token: { ...token, uid: 'a b' } }), 400, /token\.uid/],
    ['unknown token.type', reserveNow({ token: { ...token, type: 'CASH' } }), 400, /token\.type/],
    ['no contract_id', reserveNow({ token: { ...token, contract_id: undefined } }), 400, /contract_id/],
    ['reservation_id not a string', reserveNow({ reservation_id: 7 }), 400, /reservation_id/],
    ['expiry_date not a date', reserveNow({ expiry_date: 'soon' }), 400, /expiry_date/],
    ['no plate', reserveNow({ ecurious_license_plate: undefined }), 400, /ecurious_license_plate/],
    ['plate too short to read', reserveNow({ ecurious_license_plate: 'M' }), 400, /valid license plate/],
    ['no consent', reserveNow({ ecurious_plate_consent: 'yes' }), 400, /consent/],
    ['session not whole minutes', reserveNow({ ecurious_session_minutes: 1.5 }), 400, /ecurious_session_minutes/],
    ['session longer than a fast bay allows', reserveNow({ ecurious_session_minutes: 180 }), 400, /at most 2 h/],
    ['no fee', reserveNow({ ecurious_fee_cents: undefined }), 400, /ecurious_fee_cents/],
    ['response_url too long', reserveNow({ response_url: `https://x.example/${'a'.repeat(300)}` }), 400, /response_url/],
    ['another location', reserveNow({ location_id: 'ECU-ELSEWHERE' }), 200, /Unknown location_id/],
    ['another EVSE', reserveNow({ evse_uid: `${bayId}-9` }), 200, /Unknown evse_uid/],
    ['token not valid', reserveNow({ token: { ...token, valid: false } }), 200, /not valid/],
    ['expiry_date passed', reserveNow({ expiry_date: '2020-01-01T00:00:00Z' }), 200, /already passed/],
    ['price moved since the driver saw it', reserveNow({ ecurious_fee_cents: 1 }), 200, /price is now/],
  ];
  for (const [name, input, status, reason] of cases) {
    const res = await send('acme', 'RESERVE_NOW', input);
    assert.equal(res.status, status, name);
    assert.equal(res.code, status === 400 ? 2001 : 1000, name);
    assert.equal(res.data.result, 'REJECTED', name);
    assert.match(res.text, reason, name);
  }
  assert.deepEqual(calls, [], 'nothing reached the hardware');
});

test('envelope and error mapping: refusals are REJECTED, our own failures give nothing internal away', async () => {
  const env = envelope({ a: 1 });
  assert.deepEqual(Object.keys(env), ['data', 'status_code', 'status_message', 'timestamp']);
  assert.equal(env.status_code, 1000);
  assert.ok(Number.isFinite(Date.parse(env.timestamp)));
  assert.ok(!('data' in envelope(undefined, 2000, 'Missing or unknown token')), 'no data key without data');

  const err = (status: number | undefined, message: string) => Object.assign(new Error(message), status ? { status } : {});
  const map = (e: unknown) => {
    const { status, body } = commandError(e);
    const data = body.data as { result: string; timeout: number; message: { text: string }[] };
    return { status, code: body.status_code, result: data.result, timeout: data.timeout, text: data.message[0].text };
  };
  await muted(() => {
    assert.deepEqual(map(err(409, 'Bay is already reserved')), { status: 200, code: 1000, result: 'REJECTED', timeout: 0, text: 'Bay is already reserved' });
    assert.equal(map(err(403, 'This reservation belongs to another driver')).status, 200);
    assert.deepEqual([map(err(400, 'Invalid JSON')).status, map(err(400, 'x')).code], [400, 2001]);
    assert.deepEqual([map(err(413, 'Request body too large')).status, map(err(413, 'x')).code], [413, 2001]);
    const hw = map(err(502, 'Reservation hardware did not respond: connect ECONNREFUSED 10.0.0.7:8443'));
    assert.deepEqual([hw.status, hw.code, hw.result], [502, 3000, 'REJECTED']);
    assert.ok(!hw.text.includes('10.0.0.7'), 'hardware details stay in our logs');
    assert.deepEqual([map(err(undefined, 'TypeError deep inside')).text, map('weird').status], ['Internal error', 500]);
  });
});

test('rate limit: 60 requests a minute per partner, then Retry-After', () => {
  const windows = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_REQUESTS; i++) assert.equal(retryAfter('acme', t0 + i, windows), 0);
  assert.equal(retryAfter('acme', t0 + 1000, windows), 59, 'the next request waits for the window to end');
  assert.equal(retryAfter('beta', t0 + 1000, windows), 0, 'limits are per partner');
  assert.equal(retryAfter('acme', t0 + MIN, windows), 0, 'a new window starts after a minute');
});

test('a partner reserves, retries safely, polls and cancels; other partners can neither see nor touch it', async () => {
  const { r, calls, fee, send, reserveNow, status } = setup();

  const ok = await send('acme', 'RESERVE_NOW', reserveNow());
  assert.deepEqual([ok.status, ok.code, ok.data.result, ok.data.timeout], [200, 1000, 'ACCEPTED', 0]);
  assert.equal(ok.data.ecurious_fee_cents, fee);
  assert.equal(ok.data.ecurious_arrive_by, new Date(r.state(null).reservation!.expiresAt).toISOString());

  const retry = await send('acme', 'RESERVE_NOW', reserveNow());
  assert.equal(retry.data.result, 'ACCEPTED', 'a retry with the same reservation_id is safe');
  assert.match(retry.text, /nothing was changed/);
  assert.deepEqual(calls, ['reserve'], 'and books nothing twice');

  const second = await send('acme', 'RESERVE_NOW', reserveNow({ reservation_id: 'R-2' }));
  assert.deepEqual([second.status, second.data.result, second.text], [200, 'REJECTED', 'Bay is already reserved']);

  const s = status('acme', 'r-1'); // OCPI ids are case-insensitive
  assert.equal(s.status, 200);
  assert.equal(s.data.status, 'RESERVED');
  assert.equal(s.data.reservation_id, 'R-1');
  assert.equal(s.data.license_plate_hint, 'MA•••34');
  assert.equal(s.data.fees.total_cents, fee);
  assert.ok(!JSON.stringify(s).includes('MAB1234'), 'the plate itself is never returned');

  assert.equal(status('beta', 'R-1').status, 404, "another partner can't read it");
  const theirs = await send('beta', 'CANCEL_RESERVATION', { reservation_id: 'R-1' });
  assert.deepEqual([theirs.data.result, theirs.text], ['REJECTED', 'Unknown reservation_id']);
  assert.equal(r.state(null).reservation?.status, 'reserved', "or cancel it");

  const cancelled = await send('acme', 'CANCEL_RESERVATION', { response_url: 'https://emsp.example/cb', reservation_id: 'R-1' });
  assert.equal(cancelled.data.result, 'ACCEPTED');
  assert.match(cancelled.text, /No fee/, 'free within the first minutes');
  assert.equal(cancelled.data.ecurious_fee_cents, 0);
  const after = status('acme', 'R-1');
  assert.deepEqual([after.data.status, after.data.license_plate_hint, after.data.fees.total_cents], ['CANCELLED', null, 0]);
  assert.ok(after.data.ended_at);

  assert.match((await send('acme', 'CANCEL_RESERVATION', { reservation_id: 'R-1' })).text, /already ended \(CANCELLED\)/);
  assert.match((await send('acme', 'RESERVE_NOW', reserveNow())).text, /already used/);
  assert.equal((await send('acme', 'START_SESSION', {})).data.result, 'NOT_SUPPORTED');
  assert.deepEqual(calls, ['reserve', 'release']);
});

test("the camera recognises the partner's driver by plate, and the plate is gone once the session ends", async () => {
  const { r, send, reserveNow, status } = setup();
  await send('acme', 'RESERVE_NOW', reserveNow({ location_id: bayId.toLowerCase() }));
  assert.deepEqual(await r.plateEvent('MAB1234'), { matched: true, matchedBy: 'exact' });
  const s = status('acme', 'R-1');
  assert.equal(s.data.status, 'ARRIVED');
  assert.ok(s.data.checked_in_at);
  assert.match((await send('acme', 'CANCEL_RESERVATION', { reservation_id: 'R-1' })).text, /already checked in/);

  await r.plateEvent('MAB1234', 'out');
  assert.deepEqual([status('acme', 'R-1').data.status, status('acme', 'R-1').data.license_plate_hint], ['COMPLETED', null]);
  assert.ok(!JSON.stringify(r.analytics()).includes('MAB1234'), 'plate erased from the record');
});

test('partner endpoints: 401 without a known token (none configured = nobody), 429 past the limit', async () => {
  const before = process.env.OCPI_PARTNER_TOKENS;
  const req = (authorization?: string) => new Request('http://localhost/ocpi', { method: 'POST', headers: authorization ? { authorization } : {} });
  const echo = (partner: string) => ({ status: 200, body: envelope({ partner }) });
  try {
    delete process.env.OCPI_PARTNER_TOKENS;
    let res = await partnerRoute(req(`Token ${ACME}`), echo);
    assert.equal(res.status, 401, 'fails closed when OCPI_PARTNER_TOKENS is unset');
    assert.equal(res.headers.get('www-authenticate'), 'Token');
    assert.equal((await res.json()).status_code, 2000);

    process.env.OCPI_PARTNER_TOKENS = `acme:${ACME},limits:${BETA}`;
    assert.equal((await partnerRoute(req(), echo)).status, 401);
    assert.equal((await partnerRoute(req(`Token ${ACME.toUpperCase()}`), echo)).status, 401, 'tokens are case-sensitive');
    res = await partnerRoute(req(`Token ${ACME}`), echo);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.partner, 'acme');

    for (let i = 0; i < MAX_REQUESTS; i++) await partnerRoute(req(`Token ${BETA}`), echo);
    res = await partnerRoute(req(`Token ${BETA}`), echo);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
  } finally {
    if (before === undefined) delete process.env.OCPI_PARTNER_TOKENS;
    else process.env.OCPI_PARTNER_TOKENS = before;
  }
});
