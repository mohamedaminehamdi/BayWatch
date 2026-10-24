import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { cancellationFee, noShowFee, reservationFee, type ReservationType } from './booking-rules.ts';
import { claimHold, createHold, MIN_CHARGE_CENTS, paymentError, paymentMode, settleBooking, settleHold, settlement, stripe } from './payments.ts';
import { PRICES } from './pricing.ts';
import { createReservations } from './reservation.ts';

const MIN = 60_000;
const ANNA = 'user_anna';
const sk = 'sk_test_51abcdefgh';
const pk = 'pk_test_51abcdefgh';

test('test mode only: live keys are refused, half a setup is an error, no keys is the demo payment', () => {
  assert.equal(paymentMode({}), 'demo');
  assert.equal(paymentMode({ STRIPE_SECRET_KEY: sk, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), 'stripe');
  assert.equal(paymentMode({ STRIPE_SECRET_KEY: 'rk_test_51restricted', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), 'stripe', 'restricted test key');
  const refused = (e: Error) => /live keys are refused/.test(e.message) && !e.message.includes('SECRETPART');
  assert.throws(() => paymentMode({ STRIPE_SECRET_KEY: 'sk_live_SECRETPART', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), refused);
  assert.throws(() => paymentMode({ STRIPE_SECRET_KEY: 'rk_live_SECRETPART', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), refused);
  assert.throws(() => paymentMode({ STRIPE_SECRET_KEY: sk, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_SECRETPART' }), refused);
  assert.throws(() => paymentMode({ STRIPE_SECRET_KEY: sk }), /both keys/);
  assert.throws(() => paymentMode({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), /both keys/);
  assert.throws(() => paymentMode({ STRIPE_SECRET_KEY: 'not-a-key', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk }), /both keys/);
});

test('a server started with a live key fails at startup, without printing the key', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, STRIPE_SECRET_KEY: 'sk_live_SECRETPART', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_SECRETPART' };
  delete env.STRIPE_ALLOW_LIVE;
  const script = `await import(${JSON.stringify(new URL('./payments.ts', import.meta.url).href)})`;
  const load = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, stdio: 'pipe' });
  assert.throws(load, (e: { stderr: Buffer }) => /live keys are refused/.test(String(e.stderr)) && !String(e.stderr).includes('SECRETPART'));
});

test('the card is never charged more than the hold, and nothing under the €0.50 minimum', () => {
  assert.deepEqual(settlement(250, 250), { captureCents: 250, waivedCents: 0, overHoldCents: 0 });
  assert.deepEqual(settlement(250, 0), { captureCents: 0, waivedCents: 0, overHoldCents: 0 }, 'nothing due: the hold is released');
  assert.deepEqual(settlement(150, MIN_CHARGE_CENTS), { captureCents: 50, waivedCents: 0, overHoldCents: 0 }, '€0.50 itself is charged');
  assert.deepEqual(settlement(150, 49), { captureCents: 0, waivedCents: 49, overHoldCents: 0 });
  assert.deepEqual(settlement(250, 500), { captureCents: 250, waivedCents: 0, overHoldCents: 250 }, 'overstay beyond the hold');
});

// The real reservation engine on a fake clock: what each outcome settles the hold (the fee) for
function booking(type: ReservationType = 'fast') {
  let t = 1_000_000;
  const r = createReservations({ hw: { reserve: async () => {}, release: async () => {} }, type, bay: { lat: 52.52, lng: 13.405 }, now: () => t });
  const advance = async (ms: number) => {
    t += ms;
    await r.expire();
  };
  const book = () => r.reserve(ANNA, 'MAB1234', 'Blue Zoe', 60 * MIN);
  const settled = () => {
    const v = r.state(ANNA).reservation!;
    return { status: v.status, ...settlement(v.feeCents!, v.totalCents!) };
  };
  return { r, t: () => t, advance, book, settled };
}

test('each outcome captures exactly what the booking rules say', async () => {
  const fee = reservationFee('fast').cents;
  const captures = (b: ReturnType<typeof booking>) => b.settled().captureCents;

  const completed = booking();
  await completed.book();
  await completed.r.plateEvent('MAB1234');
  completed.r.finish(ANNA);
  assert.equal(completed.settled().status, 'completed');
  assert.equal(captures(completed), fee, 'completed: the full fee');

  const noShow = booking();
  await noShow.book();
  await noShow.advance(15 * MIN + 1);
  assert.equal(noShow.settled().status, 'no_show');
  assert.equal(captures(noShow), noShowFee(fee), 'no-show: half the fee');

  const prepaid = booking();
  for (let i = 0; i < 4; i++) {
    await prepaid.book();
    await prepaid.advance(15 * MIN + 1);
  }
  assert.equal(prepaid.r.state(ANNA).reservation?.prepaid, true, 'the 4th booking after 3 no-shows is prepaid');
  assert.equal(captures(prepaid), noShowFee(fee, true), 'prepaid no-show: the full fee');

  const misclick = booking();
  await misclick.book();
  await misclick.advance(MIN);
  await misclick.r.cancel(ANNA);
  assert.deepEqual(misclick.settled(), { status: 'cancelled', captureCents: 0, waivedCents: 0, overHoldCents: 0 }, 'free cancel: released');

  const late = booking();
  const bookedAt = late.t();
  await late.book();
  await late.advance(5 * MIN);
  await late.r.cancel(ANNA);
  assert.equal(captures(late), cancellationFee(fee, { bookedAt, start: bookedAt, cancelledAt: late.t() }), 'cancelled: the cancellation fee');

  const blocked = booking();
  await blocked.book();
  await blocked.advance(5 * MIN);
  await blocked.r.plateEvent('B XY 99'); // another car in the bay
  await blocked.r.cancel(ANNA);
  assert.equal(captures(blocked), 0, 'cancelled while the bay was blocked: free');

  const extended = booking();
  await extended.book();
  extended.r.extend(ANNA);
  await extended.advance(20 * MIN + 1);
  assert.equal(captures(extended), noShowFee(fee) + PRICES.extension, 'no-show after "running late": the extension fits in the hold');

  const overstay = booking();
  await overstay.book();
  await overstay.r.plateEvent('MAB1234');
  await overstay.advance(85 * MIN); // the 60-min session, the 15-min grace, 10 min over
  overstay.r.finish(ANNA);
  assert.deepEqual(overstay.settled(), { status: 'completed', captureCents: fee, waivedCents: 0, overHoldCents: 250 }, 'overstay: beyond the hold');
});

test('a cancellation fee under €0.50 is waived: the hold is released, not captured', async () => {
  const slow = booking('slow');
  await slow.book();
  await slow.advance(5 * MIN);
  await slow.r.cancel(ANNA);
  assert.deepEqual(slow.settled(), { status: 'cancelled', captureCents: 0, waivedCents: 45, overHoldCents: 0 }, '60% of the €0.75 no-show fee on €1.50');
});

// Stands in for the Stripe SDK: records each call and answers like the API would
function fakeStripe(start: Record<string, unknown> = {}) {
  let pi: Record<string, unknown> = {
    id: 'pi_1',
    amount: 250,
    amount_capturable: 250,
    amount_received: 0,
    currency: 'eur',
    status: 'requires_capture',
    cancellation_reason: null,
    client_secret: 'pi_1_secret_abc',
    metadata: { clerk_user_id: ANNA, quote_cents: '250' },
    ...start,
  };
  const calls: unknown[][] = [];
  const paymentIntents = {
    create: async (params: object, options: object) => {
      calls.push(['create', params, options]);
      return { ...pi, ...params, status: 'requires_payment_method' };
    },
    retrieve: async (id: string) => {
      calls.push(['retrieve', id]);
      return { ...pi };
    },
    capture: async (id: string, params: { amount_to_capture: number }, options: object) => {
      calls.push(['capture', id, params, options]);
      return (pi = { ...pi, status: 'succeeded', amount_capturable: 0, amount_received: params.amount_to_capture });
    },
    cancel: async (id: string, params: object, options: object) => {
      calls.push(['cancel', id, options]);
      return (pi = { ...pi, status: 'canceled', cancellation_reason: 'requested_by_customer', amount_capturable: 0 });
    },
  };
  return { s: { paymentIntents } as unknown as Stripe, calls, paymentIntents };
}

test('booking starts with a hold: manual capture, EUR, cards only, the quote in the metadata, an idempotency key', async () => {
  const { s, calls } = fakeStripe();
  const hold = await createHold({ userId: ANNA, customer: 'cus_1', cents: 250, type: 'fast', demand: 'Normal', attempt: 'try-12345' }, s);
  assert.deepEqual(hold, { clientSecret: 'pi_1_secret_abc' }, 'only the client secret goes to the browser');
  assert.deepEqual(calls[0], [
    'create',
    {
      amount: 250,
      currency: 'eur',
      capture_method: 'manual',
      allowed_payment_method_types: ['card'],
      customer: 'cus_1',
      description: 'Bay reservation: fast, normal demand',
      metadata: { clerk_user_id: ANNA, quote_cents: '250', type: 'fast', demand: 'Normal' },
    },
    { idempotencyKey: 'hold-user_anna-try-12345-250' },
  ]);
  await assert.rejects(createHold({ userId: ANNA, cents: 250, type: 'fast', demand: 'Normal', attempt: '../x' }, s), { status: 400 });
});

test('before booking, the server checks the hold: owner, authorized, amount, currency, quote, used once', async () => {
  const anna = { userId: ANNA, cents: 250 };
  const ok = fakeStripe();
  assert.equal(await claimHold('pi_ok', anna, ok.s), 'pi_ok');
  await assert.rejects(claimHold('pi_ok', anna, ok.s), { status: 409 }, 'one hold pays for one booking');

  const race = fakeStripe();
  const both = await Promise.allSettled([claimHold('pi_race', anna, race.s), claimHold('pi_race', anna, race.s)]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'two requests at once: one wins');

  await assert.rejects(claimHold(undefined, anna, fakeStripe().s), { status: 402 }, 'the browser only says it paid');
  await assert.rejects(claimHold('pi_ben', { userId: 'user_ben', cents: 250 }, fakeStripe().s), { status: 403 });
  await assert.rejects(claimHold('pi_3ds', anna, fakeStripe({ status: 'requires_action' }).s), { status: 402, message: /bank needs to confirm/ });
  await assert.rejects(claimHold('pi_declined', anna, fakeStripe({ status: 'requires_payment_method' }).s), { status: 402 });

  const mismatches = [{ amount: 200, amount_capturable: 200 }, { currency: 'usd' }, { metadata: { clerk_user_id: ANNA, quote_cents: '375' } }];
  for (const [i, wrong] of mismatches.entries()) {
    const f = fakeStripe(wrong);
    await assert.rejects(claimHold(`pi_wrong${i}`, anna, f.s), { status: 409 });
    assert.equal(f.calls.at(-1)?.[0], 'cancel', 'a hold for another price is released on the spot');
  }

  await assert.rejects(claimHold('pi_later', anna, fakeStripe({ status: 'requires_action' }).s));
  assert.equal(await claimHold('pi_later', anna, fakeStripe().s), 'pi_later', 'a refused check doesn’t use the hold up: 3DS done, it books');
});

test('settling captures what is due once, or releases the hold', async () => {
  const f = fakeStripe();
  const captured = { status: 'captured', capturedCents: 125, waivedCents: 0, overHoldCents: 0 };
  assert.deepEqual(await settleHold('pi_1', 125, f.s), captured);
  assert.deepEqual(f.calls[1], ['capture', 'pi_1', { amount_to_capture: 125 }, { idempotencyKey: 'capture-pi_1' }]);
  assert.deepEqual(await settleHold('pi_1', 125, f.s), captured, 'run again: Stripe is only read');
  assert.equal(f.calls.filter(([m]) => m === 'capture').length, 1);

  const free = fakeStripe();
  assert.deepEqual(await settleHold('pi_1', 0, free.s), { status: 'released', capturedCents: 0, waivedCents: 0, overHoldCents: 0 });
  assert.deepEqual(free.calls[1], ['cancel', 'pi_1', { idempotencyKey: 'cancel-pi_1' }]);

  const small = fakeStripe({ amount: 150, amount_capturable: 150 });
  assert.deepEqual(await settleHold('pi_1', 45, small.s), { status: 'released', capturedCents: 0, waivedCents: 45, overHoldCents: 0 });
});

test('an expired authorization is reported as expired, never as paid', async () => {
  const lapsed = fakeStripe({ status: 'canceled', cancellation_reason: 'automatic' });
  assert.equal((await settleHold('pi_1', 250, lapsed.s)).status, 'expired');
  const late = fakeStripe();
  late.paymentIntents.capture = async () => {
    throw Object.assign(new Error('expired'), { type: 'StripeInvalidRequestError', code: 'charge_expired_for_capture' });
  };
  assert.deepEqual(await settleHold('pi_1', 250, late.s), { status: 'expired', capturedCents: 0, waivedCents: 0, overHoldCents: 0 });
});

test('the end hook settles card bookings for the receipt total; demo bookings never reach Stripe', async (t) => {
  t.mock.method(console, 'error', () => {});
  const receipt = [
    { kind: 'reservation' as const, label: 'Reservation', cents: 250, at: 0 },
    { kind: 'released' as const, label: 'No-show: 50% returned', cents: -125, at: 1 },
  ];
  const card: Parameters<typeof settleBooking>[0] = { paymentIntentId: 'pi_1', feeCents: 250, charges: receipt };
  await settleBooking(card, fakeStripe().s);
  assert.deepEqual(card.payment, { status: 'captured', capturedCents: 125, waivedCents: 0, overHoldCents: 0 });

  const demo: Parameters<typeof settleBooking>[0] = { feeCents: 250, charges: receipt };
  await settleBooking(demo); // no client passed: stripe() would throw without keys
  assert.equal(demo.payment, undefined);

  const down = fakeStripe();
  down.paymentIntents.retrieve = async () => {
    throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
  };
  const offline: Parameters<typeof settleBooking>[0] = { paymentIntentId: 'pi_1', feeCents: 250, charges: receipt };
  await settleBooking(offline, down.s);
  assert.equal(offline.payment?.status, 'failed', 'logged, for a capture by hand in the Dashboard');
});

test('Stripe errors read clearly for drivers, with a status, and never quote a key', (t) => {
  t.mock.method(console, 'error', () => {});
  const cases: [Record<string, string>, number, RegExp][] = [
    [{ type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline' }, 402, /card was declined/],
    [{ type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds' }, 402, /not enough funds/],
    [{ type: 'StripeCardError', code: 'authentication_required' }, 402, /bank needs to confirm/],
    [{ type: 'StripeInvalidRequestError', code: 'payment_intent_authentication_failure' }, 402, /bank needs to confirm/],
    [{ type: 'StripeInvalidRequestError', code: 'charge_expired_for_capture' }, 409, /hold expired/],
    [{ type: 'StripeConnectionError' }, 503, /unavailable/],
    [{ type: 'StripeAuthenticationError', message: 'Invalid API Key provided: sk_test_****1234' }, 500, /set up correctly/],
  ];
  for (const [raw, status, message] of cases) {
    const e = paymentError(raw);
    assert.equal(e.status, status, raw.code ?? raw.type);
    assert.match(e.message, message);
    assert.ok(!e.message.includes('sk_'));
  }
});

test('through the real SDK: the parameters and idempotency keys reach Stripe as sent', async (t) => {
  const seen: { method?: string; path?: string; key?: string | string[]; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, key: req.headers['idempotency-key'], body: decodeURIComponent(body) });
      const captured = req.url?.endsWith('/capture');
      const pi = { id: 'pi_http', object: 'payment_intent', amount: 250, currency: 'eur', metadata: {}, client_secret: 'pi_http_secret_x' };
      const state = req.method === 'GET' ? 'requires_capture' : captured ? 'succeeded' : 'requires_payment_method';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...pi, status: state, amount_capturable: captured ? 0 : 250, amount_received: captured ? 125 : 0 }));
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(() => server.close());
  const s = new Stripe('sk_test_stub', { host: '127.0.0.1', port: (server.address() as AddressInfo).port, protocol: 'http', maxNetworkRetries: 0 });

  await createHold({ userId: ANNA, cents: 250, type: 'fast', demand: 'Normal', attempt: 'try-http-1' }, s);
  assert.equal((await settleHold('pi_http', 125, s)).capturedCents, 125);
  assert.deepEqual(
    seen.map(({ method, path, key }) => [method, path, key]),
    [
      ['POST', '/v1/payment_intents', 'hold-user_anna-try-http-1-250'],
      ['GET', '/v1/payment_intents/pi_http', undefined],
      ['POST', '/v1/payment_intents/pi_http/capture', 'capture-pi_http'],
    ],
  );
  assert.match(seen[0].body, /^amount=250&currency=eur&capture_method=manual&allowed_payment_method_types\[0\]=card&/);
  assert.equal(seen[2].body, 'amount_to_capture=125');
});

// Opt-in, against Stripe's test mode with the keys in web/.env: `node --env-file=.env --test lib/payments.test.ts`
const live = (() => {
  try {
    return paymentMode() === 'stripe';
  } catch {
    return false;
  }
})();

test('live test mode: a €2.50 hold, confirmed with the 4242 test card, captured for €1.25', { skip: !live && 'no Stripe test keys in the environment' }, async () => {
  const s = stripe();
  const driver = { userId: 'user_payments_live_test', cents: 250 };
  const hold = (attempt: string) => createHold({ ...driver, type: 'fast', demand: 'Normal', attempt: `${attempt}-${Date.now()}` }, s);
  const idOf = (secret: string | null) => secret!.split('_secret_')[0];

  const id = idOf((await hold('live-visa')).clientSecret);
  await s.paymentIntents.confirm(id, { payment_method: 'pm_card_visa' });
  assert.equal(await claimHold(id, driver, s), id);
  assert.deepEqual(await settleHold(id, 125, s), { status: 'captured', capturedCents: 125, waivedCents: 0, overHoldCents: 0 });
  const done = await s.paymentIntents.retrieve(id);
  console.log(`live test mode: ${id} is ${done.status}: held ${done.amount}, captured ${done.amount_received} cents`);

  // the 3D Secure test card: until the driver passes the bank's check there's no hold, so it can't book
  const id3ds = idOf((await hold('live-3ds')).clientSecret);
  assert.equal((await s.paymentIntents.confirm(id3ds, { payment_method: 'pm_card_authenticationRequired' })).status, 'requires_action');
  await assert.rejects(claimHold(id3ds, driver, s), { status: 402, message: /bank needs to confirm/ });
  await s.paymentIntents.cancel(id3ds);
});
