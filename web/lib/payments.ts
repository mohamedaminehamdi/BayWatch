// Card payments with Stripe, TEST MODE ONLY (docs/payments.md has the design and the wiring).
// Booking places a hold for the fee: a PaymentIntent with capture_method 'manual'. When the booking ends, the
// hold is captured for exactly what the receipt says, so there is no refund and no extra small charge; under
// Stripe's €0.50 minimum it's released instead. Without Stripe keys the app keeps its demo payment.
// The secret key stays on the server: the browser only ever gets a PaymentIntent's client secret.
// Server-only (client components must not import this file). Amounts are integer euro cents.

import Stripe from 'stripe';
import { total, type Charge } from './pricing.ts';
import { fail } from './reservation.ts';

export const MIN_CHARGE_CENTS = 50; // Stripe's minimum charge in EUR: a smaller amount due is waived
const API_VERSION = '2026-09-30.endive'; // pinned: the version stripe@23 is typed for

type Env = Record<string, string | undefined>;
const keyMode = (key: string | undefined, kinds: string) => key?.match(new RegExp(`^(?:${kinds})_(test|live)_`))?.[1];

// Test mode only: a live key (sk_live_, rk_live_ or pk_live_) is refused unless STRIPE_ALLOW_LIVE=1. Run when this
// module loads too, so a server with a live key fails at startup. Messages never include a key.
export function assertTestMode(env: Env = process.env) {
  const live = [keyMode(env.STRIPE_SECRET_KEY, 'sk|rk'), keyMode(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, 'pk')].includes('live');
  if (live && env.STRIPE_ALLOW_LIVE !== '1') {
    throw new Error('Config error: Stripe live keys are refused, this prototype runs in test mode only. Use the sk_test_ and pk_test_ keys from the Stripe Dashboard’s test mode.');
  }
}
assertTestMode();

// 'stripe' with a test key pair, 'demo' with no keys at all (the app's demo payment). Anything else is an error,
// so a half-done .env can't silently fall back to free bookings.
export function paymentMode(env: Env = process.env): 'stripe' | 'demo' {
  assertTestMode(env);
  if (!env.STRIPE_SECRET_KEY && !env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) return 'demo';
  const secret = keyMode(env.STRIPE_SECRET_KEY, 'sk|rk');
  if (!secret || secret !== keyMode(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, 'pk')) {
    throw new Error('Config error: Stripe needs both keys, STRIPE_SECRET_KEY (sk_test_…) and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…) in web/.env, or neither for demo payments.');
  }
  return 'stripe';
}

let client: Stripe | undefined;

// A driver is waiting on most calls: 10 s per request instead of Stripe's 80 s, and two retries on network
// errors, which reuse the request's idempotency key
export function stripe() {
  if (paymentMode() !== 'stripe') throw new Error('Card payments are off: no Stripe keys, so the app takes demo payments');
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 2,
    appInfo: { name: 'Ecurious Reserve' },
  }));
}

const AUTH_NEEDED = 'Your bank needs to confirm this payment. Pay again and complete the check, or use another card.';

// Stripe errors in words for drivers, with an HTTP status for handle(). Server-side faults are logged by type
// and request id only: Stripe's own message can quote part of the API key.
export function paymentError(e: unknown) {
  const { type, code, decline_code, message, requestId } = (e ?? {}) as Record<string, string | undefined>;
  const [status, text]: [number, string] =
    code === 'authentication_required' || code === 'payment_intent_authentication_failure' ? [402, AUTH_NEEDED]
    : code === 'card_declined' && decline_code === 'insufficient_funds' ? [402, 'Your card was declined: not enough funds. Try another card.']
    : code === 'card_declined' ? [402, 'Your card was declined. Try another card.']
    : code === 'expired_card' ? [402, 'Your card has expired. Try another card.']
    : code === 'charge_expired_for_capture' ? [409, 'The card hold expired before the booking ended, so it can no longer be charged.']
    : code === 'resource_missing' ? [404, 'Payment not found. Pay again to reserve.']
    : type === 'StripeCardError' ? [402, message ?? 'Your card was declined. Try another card.']
    : type === 'StripeIdempotencyError' ? [409, 'This payment is already being processed. Try again in a moment.']
    : type === 'StripeConnectionError' || type === 'StripeAPIError' || type === 'StripeRateLimitError'
      ? [503, 'Card payments are unavailable right now. Try again in a minute.']
    : type === 'StripeAuthenticationError' || type === 'StripePermissionError' ? [500, 'Card payments aren’t set up correctly on the server.']
    : [502, 'The payment didn’t go through. Try again.'];
  if (status >= 500) console.error(`Stripe ${type ?? 'error'}${code ? ` ${code}` : ''} (request ${requestId ?? 'n/a'})`);
  return Object.assign(new Error(text), { status });
}

const call = <T>(request: Promise<T>) =>
  request.catch((e: unknown): never => {
    throw paymentError(e);
  });

// 1. The driver taps "Pay": a PaymentIntent for the fee, authorized only. Card only, which includes Apple Pay and
// Google Pay; 3D Secure opens inside the page, so nothing redirects. The Payment Element
// (components/payments/card-payment.tsx) uses the same amount, currency, capture method and type.
// `attempt` comes from the dialog and stays the same until a payment goes through, so a retry after a timeout or a
// declined card gets the same PaymentIntent back instead of a new one.
export async function createHold(
  { userId, customer, cents, type, demand, attempt }: { userId: string; customer?: string; cents: number; type: string; demand: string; attempt: unknown },
  s = stripe(),
) {
  if (typeof attempt !== 'string' || !/^[\w-]{8,64}$/.test(attempt)) return fail(400, 'Missing payment attempt id');
  const intent = await call(
    s.paymentIntents.create(
      {
        amount: cents,
        currency: 'eur',
        capture_method: 'manual',
        allowed_payment_method_types: ['card'],
        customer,
        description: `Bay reservation: ${type}, ${demand.toLowerCase()} demand`,
        metadata: { clerk_user_id: userId, quote_cents: String(cents), type, demand }, // no plates or names
      },
      { idempotencyKey: `hold-${userId}-${attempt}-${cents}` },
    ),
  );
  return { clientSecret: intent.client_secret };
}

// PaymentIntents already backing a booking, so one hold can't pay for two.
// ponytail: in memory like the reservation store (server.ts); persist both together once there's a database.
const g = globalThis as typeof globalThis & { stripeHoldsInUse?: Set<string> };
const inUse = (g.stripeHoldsInUse ??= new Set<string>());

// 2. Before the booking is created. Never trust the browser's word that it paid: the PaymentIntent must be this
// driver's, authorized (requires_capture) for exactly `cents` in EUR at that quote, and not used before.
// A hold for another price can never book anything, so it's released on the spot.
export async function claimHold(id: unknown, { userId, cents }: { userId: string; cents: number }, s = stripe()) {
  if (typeof id !== 'string' || !id.startsWith('pi_')) return fail(402, 'Pay to reserve');
  if (inUse.has(id)) return fail(409, 'This payment already paid for a booking');
  inUse.add(id); // before the first await, so two requests can't both claim it
  try {
    const pi = await call(s.paymentIntents.retrieve(id));
    if (pi.metadata.clerk_user_id !== userId) fail(403, 'This payment belongs to another driver');
    if (pi.status === 'requires_action') fail(402, AUTH_NEEDED);
    if (pi.status !== 'requires_capture') fail(402, 'The card hold isn’t in place. Pay again to reserve.');
    // amount_capturable, not amount: it's what the bank actually holds
    if (pi.amount_capturable !== cents || pi.currency !== 'eur' || pi.metadata.quote_cents !== String(cents)) {
      await releaseHold(id, s);
      fail(409, 'The payment doesn’t match the price. Check it and pay again.');
    }
    return id;
  } catch (e) {
    inUse.delete(id);
    throw e;
  }
}

// For a hold that won't back a booking: the reservation failed after the driver paid. Best effort, as Stripe
// lets an uncaptured hold lapse by itself after 7 days.
export async function releaseHold(id: string, s = stripe()) {
  await s.paymentIntents.cancel(id, {}, { idempotencyKey: `cancel-${id}` }).catch((e: { type?: string; code?: string }) => {
    console.error(`Stripe: couldn't release the hold ${id} (${e.type ?? 'error'}${e.code ? ` ${e.code}` : ''}); it lapses within 7 days`);
  });
}

export type Payment = {
  status: 'settling' | 'captured' | 'released' | 'expired' | 'failed';
  capturedCents: number; // what the card was charged in the end
  waivedCents: number; // owed but under the €0.50 card minimum, so not charged
  overHoldCents: number; // owed beyond the hold (overstay, an extension on top of the full fee): not charged yet
};

// What a hold settles for: never more than the hold, and nothing under Stripe's minimum (the hold is released)
export function settlement(heldCents: number, dueCents: number) {
  const covered = Math.max(0, Math.min(dueCents, heldCents));
  const waivedCents = covered < MIN_CHARGE_CENTS ? covered : 0;
  return { captureCents: covered - waivedCents, waivedCents, overHoldCents: Math.max(0, dueCents - heldCents) };
}

// The authorization ran out before the booking was settled (about 7 days for online card payments)
const expired = (): Payment => ({ status: 'expired', capturedCents: 0, waivedCents: 0, overHoldCents: 0 });

// 3. The booking has ended: capture what's due, or release the hold when that's nothing or under the minimum.
// Safe to repeat: a settled intent is only read, and the idempotency keys stop a second capture.
export async function settleHold(id: string, dueCents: number, s = stripe()): Promise<Payment> {
  let pi = await call(s.paymentIntents.retrieve(id));
  const { captureCents, waivedCents, overHoldCents } = settlement(pi.amount, dueCents);
  if (pi.status === 'requires_capture') {
    try {
      pi = await (captureCents > 0
        ? s.paymentIntents.capture(id, { amount_to_capture: captureCents }, { idempotencyKey: `capture-${id}` })
        : s.paymentIntents.cancel(id, {}, { idempotencyKey: `cancel-${id}` }));
    } catch (e) {
      if ((e as { code?: string }).code === 'charge_expired_for_capture') return expired();
      throw paymentError(e);
    }
  }
  if (pi.status === 'succeeded') return { status: 'captured', capturedCents: pi.amount_received, waivedCents, overHoldCents };
  if (pi.status !== 'canceled') throw new Error(`Stripe: the PaymentIntent ${id} is ${pi.status}, not settled`);
  if (pi.cancellation_reason === 'automatic' || pi.cancellation_reason === 'expired') return expired();
  return { status: 'released', capturedCents: 0, waivedCents, overHoldCents };
}

// The reservation engine's end hook (server.ts): once a booking has ended and its receipt is final, a card-paid
// booking is settled for the receipt's total. Demo and partner bookings have no PaymentIntent and are left alone.
// Never throws: a failure is logged and shown as 'failed', to capture or cancel by hand in the Stripe Dashboard.
export async function settleBooking(r: { paymentIntentId?: string; feeCents: number; charges: Charge[]; payment?: Payment }, s?: Stripe) {
  if (!r.paymentIntentId) return;
  const due = total(r.charges);
  const { waivedCents, overHoldCents } = settlement(r.feeCents, due);
  r.payment = { status: 'settling', capturedCents: 0, waivedCents, overHoldCents };
  try {
    r.payment = await settleHold(r.paymentIntentId, due, s ?? stripe());
  } catch (e) {
    console.error(`Stripe: couldn't settle ${r.paymentIntentId}, capture or cancel it in the Dashboard: ${(e as Error).message}`);
    r.payment = { ...r.payment, status: 'failed' };
  }
}
