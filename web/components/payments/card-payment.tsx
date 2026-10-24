'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/components/api';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/pricing';

// Card payments are on when the publishable key is set (inlined at build time). The server needs its secret key
// as well, and refuses live keys: see lib/payments.ts.
const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export const cardPayments = !!key;
const testMode = !!key?.startsWith('pk_test_');

// Loaded on first use, so Stripe.js only runs once a driver opens the payment form
let stripeJs: Promise<Stripe | null> | undefined;
const getStripe = () => (stripeJs ??= loadStripe(key!));

// The app's tokens (globals.css): Stripe renders the form in its own iframe and can't read them. No web font,
// so the iframe doesn't fetch one from a third party.
const appearance = {
  theme: 'stripe' as const,
  variables: { colorPrimary: '#5A1DF0', colorText: '#0F1419', colorTextSecondary: '#55595E', colorDanger: '#B3261E', borderRadius: '16px' },
  rules: { '.Input': { border: '1px solid #858687' } },
};

// Any id that is new for each payment: keeps a retried tap on the same PaymentIntent (lib/payments.ts createHold)
const newAttempt = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// The card form and the pay button for a booking. Paying authorizes `cents` on the card (a hold, nothing is charged
// yet), then calls `onAuthorized` with the PaymentIntent id, which books with it. The hold is captured when the
// booking ends, for what the receipt says. The Elements options must match createHold's PaymentIntent.
export function CardPayment({ cents, disabled, onAuthorized }: { cents: number; disabled?: boolean; onAuthorized: (paymentIntentId: string) => Promise<unknown> }) {
  return (
    <Elements
      stripe={getStripe()}
      options={{ mode: 'payment', amount: cents, currency: 'eur', captureMethod: 'manual', allowedPaymentMethodTypes: ['card'], appearance }}
    >
      <PayForm cents={cents} disabled={disabled} onAuthorized={onAuthorized} />
    </Elements>
  );
}

function PayForm({ cents, disabled, onAuthorized }: { cents: number; disabled?: boolean; onAuthorized: (paymentIntentId: string) => Promise<unknown> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [attempt, setAttempt] = useState(newAttempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    try {
      // checks the form and collects wallet details (Apple Pay, Google Pay) before anything is created
      const checked = await elements.submit();
      if (checked.error) throw checked.error;
      const { clientSecret } = await api<{ clientSecret: string }>('POST', '/api/payments/intent', { priceCents: cents, attempt });
      // places the hold; when the bank asks for 3D Secure, Stripe.js opens it over this dialog
      const result = await stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required' });
      if (result.error) throw result.error;
      setAttempt(newAttempt()); // this hold now books, or the server releases it: a retry needs a new one
      await onAuthorized(result.paymentIntent.id);
    } catch (e) {
      setError(cardMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4">
      <PaymentElement />
      <div>
        <Button size="lg" className="w-full" loading={busy} disabled={disabled || !stripe || !elements} onClick={pay}>
          <CreditCard className="size-5" /> Pay {formatEuro(cents)} and reserve
        </Button>
        <p className="mt-2 text-center text-sm text-muted">
          Your card is authorized for {formatEuro(cents)} now and charged when the booking ends, only for what the fees above say.
          {testMode && ' Test mode: card 4242 4242 4242 4242, any future date, any CVC.'}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// Stripe.js words card and form errors for drivers, in their language. Our API's errors arrive as Error.
function cardMessage(e: unknown) {
  const { type, code, message } = (e ?? {}) as { type?: string; code?: string; message?: string };
  if (code === 'payment_intent_authentication_failure') return 'Your bank couldn’t confirm the payment. Try again, or use another card.';
  if ((type === 'card_error' || type === 'validation_error') && message) return message;
  return e instanceof Error ? e.message : 'The payment didn’t go through. Try again.';
}
