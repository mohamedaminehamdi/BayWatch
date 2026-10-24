import { clerkClient } from '@clerk/nextjs/server';
import { createHold, paymentError, paymentMode, stripe } from '@/lib/payments';
import { formatEuro } from '@/lib/pricing';
import { fail } from '@/lib/reservation';
import { body, handle, requireUser, reservations } from '@/lib/server';

// Step 1 of a card payment: { priceCents, attempt } → { clientSecret } for the Payment Element.
// `priceCents` is the fee the driver saw. The hold is for the server's own quote, so a stale price is refused here,
// before any card is touched. POST /api/reservations then checks the hold (lib/payments.ts claimHold).
export const POST = (req: Request) =>
  handle(async () => {
    const userId = await requireUser();
    if (paymentMode() !== 'stripe') fail(404, 'Card payments are off: this server takes demo payments');
    const { priceCents, attempt } = await body(req);
    const q = reservations.quote(userId);
    if (priceCents !== q.cents) fail(409, `The price is now ${formatEuro(q.cents)}. Check it and pay again.`);
    return createHold({ userId, customer: await customerFor(userId), cents: q.cents, type: q.type, demand: q.demand, attempt });
  });

// The driver's Stripe Customer, made on their first card payment. Its id is kept in their Clerk privateMetadata,
// which only the server can read; updateUserMetadata merges, so the cars stored there (lib/vehicles.ts) stay.
// ponytail: if a concurrent car edit overwrites the id, the idempotency key returns the same Customer for 24 h.
async function customerFor(userId: string) {
  const { users } = await clerkClient();
  const known = (await users.getUser(userId)).privateMetadata.stripeCustomerId;
  if (typeof known === 'string') return known;
  const customer = await stripe()
    .customers.create({ metadata: { clerk_user_id: userId } }, { idempotencyKey: `customer-${userId}` })
    .catch((e: unknown) => {
      throw paymentError(e);
    });
  await users.updateUserMetadata(userId, { privateMetadata: { stripeCustomerId: customer.id } });
  return customer.id;
}
