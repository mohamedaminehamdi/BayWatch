import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerOk, createVoice, type BookingService, type VoiceBay } from './voice.ts';

const MIN = 60_000;
const BAYS: VoiceBay[] = [
  { id: 'bw-1', name: 'Baywatch Bay 1', address: 'Hackathon venue, Berlin', class: 'fast' },
  { id: 'bw-2', name: 'Baywatch Bay 2', address: 'Hackathon venue, Berlin', class: 'fast' },
];
// Saturday 24 Oct 2026, 14:00 in Berlin (summer time ends the next night, so tomorrow is UTC+1)
const T0 = Date.UTC(2026, 9, 24, 12, 0);

function setup({ cents = 250 } = {}) {
  let clock = T0;
  const taken: { bayId: string; start: number; end: number }[] = [];
  const booked: { id: string; account: string; bayId: string; start: number; blocks: number; priceCents: number }[] = [];
  const price = { cents };
  const clash = (bayId: string, start: number, end: number) =>
    [...taken, ...booked.map((b) => ({ ...b, end: b.start + b.blocks * 15 * MIN }))].some((x) => x.bayId === bayId && start < x.end && x.start < end);
  const service: BookingService = {
    bays: () => BAYS,
    quote: (bayId, start, blocks) => ({ cents: price.cents, valid: !clash(bayId, start, start + blocks * 15 * MIN) }),
    book: async (account, s) => {
      await new Promise((r) => setTimeout(r, 5)); // slow enough for a parallel confirm to arrive meanwhile
      if (clash(s.bayId, s.start, s.start + s.blocks * 15 * MIN)) throw Object.assign(new Error('Taken'), { status: 409 });
      const b = { id: `bk-${booked.length + 1}`, account, ...s };
      booked.push(b);
      return { id: b.id };
    },
  };
  const voice = createVoice({ service, now: () => clock });
  // one Vapi tool call, answered through the envelope, parsed back
  const tool = async (name: string, args: unknown, { callId = 'call-1', account = 'user_demo', at = clock } = {}) => {
    const res = await voice.handle(
      { message: { type: 'tool-calls', timestamp: at, call: { id: callId }, toolCallList: [{ id: 'tc-1', type: 'function', function: { name, arguments: args } }] } },
      account,
    );
    const [r] = (res as { results: { toolCallId: string; result?: string; error?: string }[] }).results;
    assert.equal(r.toolCallId, 'tc-1');
    return r.result ? JSON.parse(r.result) : r;
  };
  return { tool, voice, taken, booked, price, tick: (ms: number) => (clock += ms) };
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
  assert.deepEqual([booked[0].account, booked[0].bayId, booked[0].blocks, booked[0].priceCents], ['user_demo', 'bw-1', 3, 250]);
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
  assert.deepEqual(await voice.handle({ message: { type: 'status-update' } }, 'user_demo'), {});
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
    'user_demo',
  )) as { results: { toolCallId: string; result?: string; error?: string }[] };
  assert.deepEqual(res.results.map((r) => r.toolCallId), ['a', 'b']);
  assert.equal(typeof res.results[0].result, 'string');
  assert.match(res.results[1].error!, /Unknown tool/);
  const noCall = (await voice.handle({ message: { type: 'tool-calls', toolCallList: [{ id: 'c', function: { name: 'quote_reservation' } }] } }, 'u')) as {
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
