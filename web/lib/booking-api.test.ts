import test from 'node:test';
import assert from 'node:assert/strict';
import type { BayInfo } from './bays.ts';
import { bookingApi, type Payments } from './booking-api.ts';
import { ARRIVAL_GRACE_MS, earliestStart } from './booking-rules.ts';
import { fail } from './errors.ts';
import { createSchedule } from './schedule.ts';

const MIN = 60_000;
const H = 60 * MIN;
const VOICE = 'user_voice_demo';
const ANNA = 'user_anna';
const BW1: BayInfo = { id: 'bw-1', name: 'Baywatch Bay 1', lat: 52.52, lng: 13.405, address: 'Venue', points: [{ type: 'CCS', power: 200, count: 1 }], powerKw: 200, class: 'fast', real: true, guard: 'simulated' };
const GE: BayInfo = { ...BW1, id: 'ge-1', name: 'Somewhere', real: false };

// The real engine with fake card holds: `mode` says whether Stripe keys are set
function setup(mode: 'stripe' | 'demo' = 'demo', wallet = { creditCents: 0, firstFree: true }) {
  const hw = { raise: async () => {}, lower: async () => {}, setPlates: async () => {}, status: async () => ({ state: 'blocked', mock: true }) };
  const loads: string[] = [];
  const holds: string[] = [];
  const schedule = createSchedule({
    bays: [BW1],
    hw,
    wallets: { load: async (id) => (loads.push(id), { ...wallet }), save: async () => {} },
  });
  schedule.knowBay(GE);
  const cars = [{ id: 'car-1', plate: 'MAB1234', display: 'M AB 1234', label: 'Blue Zoe', consentAt: 0 }];
  const payments: Payments = {
    mode: () => mode,
    claim: async (id, { cents }) => {
      if (id !== 'pi_ok') fail(402, 'Pay to reserve');
      holds.push(`claim ${id} ${cents}`);
      return 'pi_ok';
    },
    release: async (id) => void holds.push(`release ${id}`),
  };
  const api = bookingApi(schedule, { list: async () => cars }, payments);
  const start = earliestStart(Date.now()) + H;
  return { api, schedule, loads, holds, start };
}

test('voice: bays() is the Baywatch bays only, quote() is cheap and checks the slot, reserve() books like the API', async () => {
  const { api, loads, start } = setup();
  assert.deepEqual(api.bays(), [{ id: 'bw-1', name: 'Baywatch Bay 1', address: 'Venue', class: 'fast' }]);
  const first = api.quote('bw-1', start, 4, VOICE);
  assert.equal(first.valid, true);
  assert.equal(first.creditAppliedCents, undefined, 'the wallet isn’t loaded yet: no waiting on Clerk');
  await new Promise((r) => setImmediate(r));
  assert.equal(api.quote('bw-1', start, 4, VOICE).creditAppliedCents, first.cents, 'loaded once in the background: the free first booking');
  for (let i = 0; i < 100; i++) api.quote('bw-1', start + i * 15 * MIN, 4, VOICE);
  assert.deepEqual(loads, [VOICE], 'one Clerk read for 100 quotes');
  assert.deepEqual(api.quote('bw-1', start + 7 * MIN, 4, VOICE), { cents: first.cents, valid: false, start: start + 7 * MIN, end: start + 67 * MIN, reason: 'Start on the quarter hour: :00, :15, :30 or :45', creditAppliedCents: first.cents });
  assert.equal(api.quote('nope', start, 4, VOICE).valid, false);

  const v = await api.reserve(VOICE, { bayId: 'bw-1', start, blocks: 4, priceCents: first.cents, acceptFees: true, payment: 'demo' });
  assert.deepEqual([v.bayId, v.start, v.vehicleLabel, v.totalCents], ['bw-1', start, 'Blue Zoe', 0]);
  assert.match(api.quote('bw-1', start, 4, VOICE).reason ?? '', /overlaps/, 'taken now');
  await assert.rejects(api.reserve(VOICE, { bayId: 'bw-1', start, blocks: 4, priceCents: first.cents, acceptFees: true, payment: 'demo' }), { status: 409 });
  await assert.rejects(api.reserve(VOICE, { bayId: 'bw-1', start: start + 3 * H, blocks: 4, priceCents: 1, acceptFees: true, payment: 'demo' }), {
    status: 409,
    message: /price is now/,
  });
  await assert.rejects(api.reserve(VOICE, { bayId: 'bw-1', start: start + 3 * H, blocks: 4, vehicleId: 'car-9', priceCents: first.cents, acceptFees: true, payment: 'demo' }), {
    status: 404,
  });
});

test('the demo payment: with Stripe keys set, only voice with VOICE_DEMO=1 may use it', async () => {
  const { api, start } = setup('stripe');
  const slot = (s: number) => ({ bayId: 'bw-1', start: s, blocks: 4, priceCents: api.quote('bw-1', s, 4, ANNA).cents, acceptFees: true as const, payment: 'demo' as const });
  delete process.env.VOICE_DEMO;
  await assert.rejects(api.reserve(ANNA, slot(start)), { status: 402, message: 'Pay by card to reserve' });
  process.env.VOICE_DEMO = '1';
  try {
    assert.equal((await api.reserve(ANNA, slot(start))).status, 'upcoming', 'any signed-in account, in voice demo mode');
  } finally {
    delete process.env.VOICE_DEMO;
  }
  const keyless = setup('demo');
  assert.equal((await keyless.api.reserve(ANNA, { ...slot(start), priceCents: keyless.api.quote('bw-1', start, 4, ANNA).cents })).status, 'upcoming', 'no Stripe keys');
});

test('the web never passes the browser’s payment field on: without keys it’s the demo payment, with keys a verified card hold', async () => {
  const demo = setup('demo');
  const price = (s: ReturnType<typeof setup>, t: number) => s.api.quote('bw-1', t, 4, ANNA).cents;
  assert.equal((await demo.api.reserveFromWeb(ANNA, { bayId: 'bw-1', start: demo.start, blocks: 4, priceCents: price(demo, demo.start), acceptFees: true, payment: 'card' })).status, 'upcoming');

  const card = setup('stripe', { creditCents: 100, firstFree: false });
  const s = card.start;
  const input = (t: number, extra: Record<string, unknown> = {}) => ({ bayId: 'bw-1', start: t, blocks: 4, priceCents: price(card, t), acceptFees: true, ...extra });
  await assert.rejects(card.api.reserveFromWeb(ANNA, input(s, { payment: 'demo' })), { status: 402 }, 'payment: demo from a browser books nothing');
  const v = await card.api.reserveFromWeb(ANNA, input(s, { paymentIntentId: 'pi_ok' }));
  assert.equal(v.totalCents, 400, 'the fee after the €1 credit');
  assert.deepEqual(card.holds, ['claim pi_ok 400'], 'the hold is for what the slot costs after credit');
  await assert.rejects(card.api.reserveFromWeb(ANNA, input(s, { paymentIntentId: 'pi_ok' })), { status: 409 });
  assert.deepEqual(card.holds, ['claim pi_ok 400'], 'a slot already taken is refused before the card is touched');
  const later = s + 3 * H;
  await assert.rejects(card.api.reserveFromWeb(ANNA, input(later, { paymentIntentId: 'pi_ok', priceCents: 1 })), { status: 409, message: /price is now/ });
  assert.deepEqual(card.holds, ['claim pi_ok 400', 'claim pi_ok 500', 'release pi_ok'], 'a booking that fails after the claim releases its hold');
});

test('Book now: this moment, from the block under way for at least an hour; the arm rises at once for the driver’s plate only', async () => {
  const t = earliestStart(Date.now()) + 2 * H + 8 * MIN; // 8 minutes into a block, like 16:23
  const block = t - 8 * MIN;
  const raised: [string, string[]][] = [];
  const schedule = createSchedule({
    bays: [{ ...BW1, guard: 'hardware', lockId: 'lock-0001' }],
    hw: { raise: async (id: string, plates: string[]) => void raised.push([id, plates]), lower: async () => {}, setPlates: async () => {}, status: async () => ({ state: 'blocked', mock: true }) },
    wallets: { load: async () => ({ creditCents: 0, firstFree: false }), save: async () => {} },
    now: () => t,
  });
  const car = { id: 'car-1', plate: 'A613EN', cameraPlate: '湘A613EN', display: '湘A 613-EN', label: 'Test car', consentAt: 0 };
  const demo: Payments = { mode: () => 'demo', claim: async () => fail(402, 'no card in this test'), release: async () => {} };
  const api = bookingApi(schedule, { list: async () => [car] }, demo);
  const q = api.quote('bw-1', 'now', 0, ANNA);
  assert.deepEqual([q.valid, q.start, q.end], [true, block, block + 75 * MIN], '16:23 → 16:15–17:30');
  const v = await api.reserveFromWeb(ANNA, { bayId: 'bw-1', now: true, priceCents: q.cents, acceptFees: true });
  assert.deepEqual([v.start, v.end, v.arriveBy], [block, block + 75 * MIN, t + ARRIVAL_GRACE_MS], 'the arrival grace counts from booking');
  assert.deepEqual(raised, [['lock-0001', ['湘A613EN']]], 'raised at once, with only the driver’s plate on the allow-list');
});
