import test from 'node:test';
import assert from 'node:assert/strict';
import type { BayInfo } from './bays.ts';
import { bookingApi } from './booking-api.ts';
import { createSchedule } from './schedule.ts';
import { bearerOk, createVoice, signVoiceToken, verifyVoiceToken, type BookingService, type VoiceBay, type VoiceConfig } from './voice.ts';

const MIN = 60_000;
const BAYS: VoiceBay[] = [
  { id: 'bw-1', name: 'Baywatch Bay 1', address: 'Hackathon venue, Berlin', class: 'fast' },
  { id: 'bw-2', name: 'Baywatch Bay 2', address: 'Hackathon venue, Berlin', class: 'fast' },
];
// Saturday 24 Oct 2026, 14:00 in Berlin (summer time ends the next night, so tomorrow is UTC+1)
const T0 = Date.UTC(2026, 9, 24, 12, 0);
const SECRET = 'test-secret';

function setup({ cents = 250 } = {}) {
  let clock = T0;
  const taken: { bayId: string; start: number; end: number }[] = [];
  const booked: { id: string; account: string; bayId: string; start: number; blocks: number; priceCents: number; vehicleId: string }[] = [];
  const cars: Record<string, string> = { user_demo: 'car-1' }; // each driver's first car
  const price = { cents, moveOnBook: false }; // moveOnBook: the price changes while the booking is being made
  const clash = (bayId: string, start: number, end: number) =>
    [...taken, ...booked.map((b) => ({ ...b, end: b.start + b.blocks * 15 * MIN }))].some((x) => x.bayId === bayId && start < x.end && x.start < end);
  const service: BookingService = {
    bays: () => BAYS,
    quote: (bayId, start, blocks) => ({ cents: price.cents, valid: !clash(bayId, start, start + blocks * 15 * MIN) }),
    book: async (account, s) => {
      await new Promise((r) => setTimeout(r, 5)); // slow enough for a parallel confirm to arrive meanwhile
      if (price.moveOnBook) {
        price.cents += 125;
        throw Object.assign(new Error('The price is now €3.75'), { status: 409 });
      }
      if (clash(s.bayId, s.start, s.start + s.blocks * 15 * MIN)) throw Object.assign(new Error('Taken'), { status: 409 });
      const b = { id: `bk-${booked.length + 1}`, account, ...s };
      booked.push(b);
      return { id: b.id };
    },
    vehicle: async (account) => (cars[account] ? { id: cars[account] } : null),
  };
  const cfg: VoiceConfig = { enabled: true, secret: SECRET };
  const voice = createVoice({ service, now: () => clock });
  // One Vapi tool call, answered through the envelope, parsed back. By default it comes from the app's mic,
  // with a fresh token for `account` in the call's metadata; `token: null` is a phone call.
  const tool = async (
    name: string,
    args: unknown,
    { callId = 'call-1', account = 'user_demo', at = clock, token }: { callId?: string; account?: string; at?: number; token?: string | null } = {},
  ) => {
    const voiceToken = token === undefined ? signVoiceToken(account, SECRET, clock)!.token : token;
    const call = { id: callId, ...(voiceToken === null ? {} : { assistantOverrides: { metadata: { voiceToken } } }) };
    const res = await voice.handle(
      { message: { type: 'tool-calls', timestamp: at, call, toolCallList: [{ id: 'tc-1', type: 'function', function: { name, arguments: args } }] } },
      cfg,
    );
    const [r] = (res as { results: { toolCallId: string; result?: string; error?: string }[] }).results;
    assert.equal(r.toolCallId, 'tc-1');
    return r.result ? JSON.parse(r.result) : r;
  };
  return { tool, voice, cfg, cars, taken, booked, price, tick: (ms: number) => (clock += ms) };
}

const tomorrow = { place: 'Baywatch', date: 'tomorrow', time: '15:00', durationMinutes: 45 };

test('a quote reads back the exact slot in Berlin time and books nothing', async () => {
  const { tool, booked } = setup();
  const q = await tool('quote_reservation', tomorrow);
  assert.equal(q.status, 'available');
  assert.equal(q.start, '2026-10-25T15:00:00+01:00', 'winter time again after the clock change');
  assert.equal(q.end, '2026-10-25T15:45:00+01:00');
  assert.equal(q.timezone, 'Europe/Berlin');
  assert.deepEqual([q.durationMinutes, q.priceCents, q.currency], [45, 250, 'EUR']);
  assert.equal(q.station.name, 'Baywatch Bay 1');
  assert.match(q.confirmationText, /tomorrow from 15:00 to 15:45, 45 minutes\. The reservation fee is 2 euros 50\. Shall I book it\?/);
  assert.equal(booked.length, 0);
});

test('Vapi may send arguments as a JSON string', async () => {
  const { tool } = setup();
  assert.equal((await tool('quote_reservation', JSON.stringify(tomorrow))).status, 'available');
});

test('confirming twice, even in parallel, books exactly once', async () => {
  const { tool, booked, tick } = setup();
  const { quoteId } = await tool('quote_reservation', tomorrow);
  const [a, b] = await Promise.all([tool('confirm_reservation', { quoteId }), tool('confirm_reservation', { quoteId })]);
  assert.equal(a.status, 'confirmed');
  assert.equal(a.bookingId, b.bookingId);
  tick(10 * MIN); // a repeat after the quote's expiry still answers with the same booking
  assert.equal((await tool('confirm_reservation', { quoteId })).bookingId, a.bookingId);
  assert.equal(booked.length, 1);
  assert.deepEqual([booked[0].account, booked[0].bayId, booked[0].blocks, booked[0].priceCents, booked[0].vehicleId], ['user_demo', 'bw-1', 3, 250, 'car-1']);
});

test('expired, foreign, unknown or overtaken quotes cannot be confirmed', async () => {
  const { tool, booked, tick, taken, price } = setup();
  const { quoteId } = await tool('quote_reservation', tomorrow);
  assert.equal((await tool('confirm_reservation', { quoteId }, { callId: 'call-2' })).status, 'error', 'bound to its call');
  assert.equal((await tool('confirm_reservation', { quoteId }, { account: 'user_other' })).status, 'error', 'bound to the demo account');
  assert.equal((await tool('confirm_reservation', { quoteId: 'nope' })).status, 'error');

  price.cents = 375;
  assert.equal((await tool('confirm_reservation', { quoteId })).status, 'expired', 'the price moved since the quote');
  price.cents = 250;

  taken.push({ bayId: 'bw-1', start: Date.UTC(2026, 9, 25, 14, 0), end: Date.UTC(2026, 9, 25, 15, 0) });
  const gone = await tool('confirm_reservation', { quoteId });
  assert.equal(gone.status, 'unavailable');
  assert.equal(gone.alternatives[0].place, 'Baywatch Bay 2', 'the same time at the other bay first');
  taken.length = 0;

  price.moveOnBook = true; // the engine refuses with a 409 because the price moved in that moment
  const moved = await tool('confirm_reservation', { quoteId });
  assert.deepEqual([moved.status, moved.priceCents], ['expired', 375], 'quoted again: still free, new price');
  price.moveOnBook = false;
  price.cents = 250;

  tick(6 * MIN);
  assert.equal((await tool('confirm_reservation', { quoteId })).status, 'expired');
  assert.equal(booked.length, 0);
});

test('a taken slot offers at most two free alternatives, in quote_reservation’s own arguments', async () => {
  const { tool, taken } = setup();
  for (const bayId of ['bw-1', 'bw-2']) taken.push({ bayId, start: Date.UTC(2026, 9, 25, 14, 0), end: Date.UTC(2026, 9, 25, 14, 45) });
  const u = await tool('quote_reservation', tomorrow);
  assert.equal(u.status, 'unavailable');
  assert.equal(u.alternatives.length, 2);
  for (const alt of u.alternatives) {
    assert.equal((await tool('quote_reservation', alt)).status, 'available', `${alt.place} ${alt.time} is really free`);
  }

  taken.length = 0;
  taken.push({ bayId: 'bw-1', start: Date.UTC(2026, 9, 25, 14, 0), end: Date.UTC(2026, 9, 25, 14, 45) });
  assert.equal((await tool('quote_reservation', tomorrow)).station.name, 'Baywatch Bay 2', '"Baywatch" takes any free Baywatch bay');
  const bay1 = await tool('quote_reservation', { ...tomorrow, place: 'Baywatch bay 1' });
  assert.equal(bay1.status, 'unavailable', 'a named bay stays that bay');
});

test('unclear requests get one specific question', async () => {
  const { tool } = setup();
  const ask = async (args: object, re: RegExp) => {
    const r = await tool('quote_reservation', { ...tomorrow, ...args });
    assert.equal(r.status, 'needs_clarification', JSON.stringify(args));
    assert.match(r.question, re);
  };
  await ask({ place: '' }, /Where/);
  await ask({ place: 'Alexanderplatz' }, /only book Baywatch Bay 1, Baywatch Bay 2/);
  await ask({ date: 'next week' }, /Which day/);
  await ask({ date: '2026-02-30' }, /Which day/);
  await ask({ date: '2026-10-20' }, /in the past/);
  await ask({ date: '2027-01-15' }, /up to 60 days/);
  await ask({ date: 'today', time: '09:00' }, /passed today\. Do you mean tomorrow at 09:00/);
  await ask({ time: '3pm' }, /What time/);
  await ask({ time: '15:10' }, /quarter hour\. 15:00 or 15:15/);
  await ask({ durationMinutes: 0 }, /How long/);
  await ask({ durationMinutes: 180 }, /at most 2 hours/);
});

test('a night-time start is asked once per call, then accepted', async () => {
  const { tool } = setup();
  const night = { ...tomorrow, time: '03:00' };
  assert.match((await tool('quote_reservation', night)).question, /03:00 at night, not 15:00/);
  assert.equal((await tool('quote_reservation', night)).status, 'available');
  assert.equal((await tool('quote_reservation', night, { callId: 'call-2' })).status, 'needs_clarification');
});

test('"now" books the block under way or the next one; whole quarter hours are booked', async () => {
  const { tool, tick } = setup();
  tick(2 * MIN); // 14:02
  assert.equal((await tool('quote_reservation', { ...tomorrow, date: 'today', time: '14:02' })).start, '2026-10-24T14:00:00+02:00');
  tick(5 * MIN); // 14:07: the 14:00 block is too far gone
  assert.equal((await tool('quote_reservation', { ...tomorrow, date: 'today', time: '14:00' })).start, '2026-10-24T14:15:00+02:00');
  const r = await tool('quote_reservation', { ...tomorrow, durationMinutes: 50 });
  assert.equal(r.durationMinutes, 60);
  assert.match(r.confirmationText, /1 hour, rounded up to whole quarter hours/);
});

test('relative dates count from the call, in Berlin', async () => {
  const { tool, tick } = setup();
  const callAt = Date.UTC(2026, 9, 24, 21, 58); // 23:58 Saturday in Berlin
  tick(callAt + 3 * MIN - T0); // the tool call lands at 00:01 Sunday
  const r = await tool('quote_reservation', tomorrow, { at: callAt });
  assert.equal(r.start, '2026-10-25T15:00:00+01:00', 'tomorrow as the caller meant it');
});

test('the envelope: one result per toolCallId, errors for unknown tools, nothing for other messages', async () => {
  const { voice } = setup();
  const phone: VoiceConfig = { enabled: true, secret: SECRET, demoUserId: 'user_demo' };
  assert.deepEqual(await voice.handle({ message: { type: 'status-update' } }, phone), {});
  const res = (await voice.handle(
    {
      message: {
        type: 'tool-calls',
        call: { id: 'call-1' },
        toolCallList: [
          { id: 'a', function: { name: 'quote_reservation', arguments: tomorrow } },
          { id: 'b', function: { name: 'cancel_reservation', arguments: {} } },
        ],
      },
    },
    phone,
  )) as { results: { toolCallId: string; result?: string; error?: string }[] };
  assert.deepEqual(res.results.map((r) => r.toolCallId), ['a', 'b']);
  assert.equal(typeof res.results[0].result, 'string');
  assert.match(res.results[1].error!, /Unknown tool/);
  const noCall = (await voice.handle({ message: { type: 'tool-calls', toolCallList: [{ id: 'c', function: { name: 'quote_reservation' } }] } }, phone)) as {
    results: { error?: string }[];
  };
  assert.match(noCall.results[0].error!, /call id/);
});

test('bearerOk fails closed and wants the exact bearer token', () => {
  assert.equal(bearerOk('Bearer s3cret', undefined), false, 'no secret configured');
  assert.equal(bearerOk('Bearer s3cret', ''), false);
  assert.equal(bearerOk(null, 's3cret'), false);
  assert.equal(bearerOk('s3cret', 's3cret'), false);
  assert.equal(bearerOk('Bearer wrong!', 's3cret'), false);
  assert.equal(bearerOk('Bearer s3cret', 's3cret'), true);
});

test('the app’s mic books for the driver in the signed token; a bad token books nothing, demo account or not', async () => {
  const { tool, booked, tick, cars, cfg } = setup();
  cars.user_ana = 'car-ana';
  const { quoteId } = await tool('quote_reservation', tomorrow, { account: 'user_ana' });
  assert.equal((await tool('confirm_reservation', { quoteId }, { account: 'user_ana' })).status, 'confirmed');
  assert.deepEqual([booked[0].account, booked[0].vehicleId], ['user_ana', 'car-ana']);

  cfg.demoUserId = 'user_demo'; // must not rescue a bad token
  const real = signVoiceToken('user_ana', SECRET, T0)!.token;
  const altered = `${Buffer.from(JSON.stringify({ u: 'user_demo', exp: T0 + 15 * MIN })).toString('base64url')}.${real.split('.')[1]}`;
  for (const token of [signVoiceToken('user_ana', 'not-our-secret', T0)!.token, altered, 'garbage', '']) {
    const r = await tool('quote_reservation', tomorrow, { token });
    assert.equal(r.status, 'error', `token ${JSON.stringify(token.slice(0, 12))}`);
    assert.match(r.message, /start the call again from the mic/);
  }
  tick(16 * MIN);
  assert.equal((await tool('quote_reservation', tomorrow, { token: real })).status, 'error', 'tokens last 15 minutes');
  assert.equal(booked.length, 1);
});

test('a phone call has no token: it books for the demo account if one is set, otherwise points to the app', async () => {
  const { tool, booked, cfg } = setup();
  const phone = { token: null };
  assert.match((await tool('quote_reservation', tomorrow, phone)).message, /works from the mic in the Baywatch app/);
  cfg.demoUserId = 'user_demo';
  const { quoteId } = await tool('quote_reservation', tomorrow, phone);
  assert.equal((await tool('confirm_reservation', { quoteId }, phone)).status, 'confirmed');
  assert.equal(booked[0].account, 'user_demo');
});

test('no car, no booking; and nothing at all unless VOICE_DEMO is on', async () => {
  const { tool, cfg, cars, booked } = setup();
  const { quoteId } = await tool('quote_reservation', tomorrow); // while the driver still has a car
  delete cars.user_demo;
  assert.match((await tool('quote_reservation', tomorrow)).message, /Add a car in the Baywatch app first/);
  assert.match((await tool('confirm_reservation', { quoteId })).message, /Add a car/);
  cars.user_demo = 'car-1';
  cfg.enabled = false;
  assert.match((await tool('confirm_reservation', { quoteId })).message, /switched off/);
  assert.equal(booked.length, 0);
});

test('session tokens fail closed without a secret', () => {
  assert.equal(signVoiceToken('user_a', undefined, T0), null);
  const { token, expiresAt } = signVoiceToken('user_a', SECRET, T0)!;
  assert.equal(expiresAt, T0 + 15 * MIN);
  assert.equal(verifyVoiceToken(token, undefined, T0), null);
  assert.equal(verifyVoiceToken(token, SECRET, T0), 'user_a');
});

// VERIFY against the real v2 engine (schedule.ts + booking-api.ts), with fake hardware, wallets and cars as in
// booking-api.test.ts. Real clock: the bookings are for tomorrow afternoon.
test('the real engine: bookings land under the token’s driver, quotes book nothing, stale quotes are refused', async () => {
  const bay = (n: number): BayInfo => ({
    id: `bw-${n}`, name: `Baywatch Bay ${n}`, lat: 52.52, lng: 13.405, address: 'Hackathon venue, Berlin',
    points: [{ type: 'CCS', power: 200, count: 1 }], powerKw: 200, class: 'fast', real: true, guard: 'simulated',
  });
  const hw = { raise: async () => {}, lower: async () => {}, setPlates: async () => {}, status: async () => ({ state: 'blocked', mock: true }) };
  const schedule = createSchedule({ bays: [bay(1), bay(2)], hw, wallets: { load: async () => ({ creditCents: 0, firstFree: false }), save: async () => {} } });
  const car = (id: string) => [{ id, plate: 'MAB1234', display: 'M AB 1234', label: 'Blue Zoe', consentAt: 0 }];
  const cars: Record<string, ReturnType<typeof car>> = { user_ana: car('car-ana'), user_ben: car('car-ben') };
  const api = bookingApi(schedule, { list: async (id) => cars[id] ?? [] }, { mode: () => 'demo', claim: async () => 'x', release: async () => {} });
  let skew = 0;
  const voice = createVoice({
    now: () => Date.now() + skew,
    service: {
      bays: api.bays,
      quote: api.quote,
      book: (userId, slot) => api.reserve(userId, { ...slot, acceptFees: true, payment: 'demo' }),
      vehicle: async (userId) => cars[userId]?.[0] ?? null,
    },
  });
  const cfg: VoiceConfig = { enabled: true, secret: SECRET };
  const tool = async (name: string, args: unknown, account: string, callId = `call-${account}`) => {
    const voiceToken = signVoiceToken(account, SECRET, Date.now())!.token;
    const res = (await voice.handle(
      { message: { type: 'tool-calls', timestamp: Date.now(), call: { id: callId, assistantOverrides: { metadata: { voiceToken } } }, toolCallList: [{ id: 't', function: { name, arguments: args } }] } },
      cfg,
    )) as { results: { result: string }[] };
    return JSON.parse(res.results[0].result);
  };
  const upcoming = async (userId: string) => (await schedule.bookingsOf(userId)).upcoming;

  const q = await tool('quote_reservation', tomorrow, 'user_ana');
  assert.equal(q.status, 'available', JSON.stringify(q));
  assert.equal((await upcoming('user_ana')).length, 0, 'a quote alone creates nothing');

  const [a, b] = await Promise.all([tool('confirm_reservation', { quoteId: q.quoteId }, 'user_ana'), tool('confirm_reservation', { quoteId: q.quoteId }, 'user_ana')]);
  assert.equal(a.status, 'confirmed', JSON.stringify(a));
  assert.equal(a.bookingId, b.bookingId);
  const mine = await upcoming('user_ana');
  assert.equal(mine.length, 1, 'repeated confirm, one booking');
  assert.deepEqual([mine[0].id, mine[0].bayId, mine[0].blocks, mine[0].feeCents], [a.bookingId, 'bw-1', 3, a.priceCents]);
  assert.equal(new Date(mine[0].start).toISOString(), new Date(a.start).toISOString(), 'the future slot that was read back');
  assert.equal((await upcoming('user_ben')).length, 0, 'under the token’s driver only');

  // Ben, same time: bw-1 is taken, so "Baywatch" gets bw-2, and "Baywatch Bay 1" offers free alternatives
  assert.equal((await tool('quote_reservation', tomorrow, 'user_ben')).station.name, 'Baywatch Bay 2');
  const taken = await tool('quote_reservation', { ...tomorrow, place: 'Baywatch Bay 1' }, 'user_ben');
  assert.equal(taken.status, 'unavailable');
  assert.ok(taken.alternatives.length >= 1 && taken.alternatives.length <= 2);
  for (const alt of taken.alternatives) assert.equal((await tool('quote_reservation', alt, 'user_ben')).status, 'available', JSON.stringify(alt));

  // a quote someone else books first can't be confirmed; neither can an expired one
  const later = { ...tomorrow, place: 'Baywatch Bay 2', time: '17:00' };
  const stale = await tool('quote_reservation', later, 'user_ben');
  await api.reserve('user_ana', { bayId: 'bw-2', start: Date.parse(stale.start), blocks: 3, priceCents: stale.priceCents, acceptFees: true, payment: 'demo' });
  assert.equal((await tool('confirm_reservation', { quoteId: stale.quoteId }, 'user_ben')).status, 'unavailable');
  const old = await tool('quote_reservation', { ...later, time: '19:30' }, 'user_ben');
  skew = 6 * MIN;
  assert.equal((await tool('confirm_reservation', { quoteId: old.quoteId }, 'user_ben')).status, 'expired');
  assert.equal((await upcoming('user_ben')).length, 0);
});
