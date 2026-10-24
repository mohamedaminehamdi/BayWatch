// Who gets what from one booking: the driver pays the receipt, Stripe takes its fee, and the rest is split
// between the charge point operator (CPO) and BayWatch. Pure, without project imports, like booking-rules.ts.
// Money is integer euro cents. The per-booking tables and the hardware payback: docs/unit-economics.md.

// Stripe's standard price for cards issued in the EEA: 1.5% + €0.25 per successful payment (UK cards 2.5%, others
// 3.25% + 2% conversion). A refund doesn't give the fee back. Once Stripe is live, pass the balance transaction's fee.
export const STRIPE_PERCENT = 1.5;
export const STRIPE_FIXED_CENTS = 25;
export const stripeFeeCents = (paidCents: number) => (paidCents > 0 ? Math.round((paidCents * STRIPE_PERCENT) / 100) + STRIPE_FIXED_CENTS : 0);

// The CPO's shares before Stripe's fee, both assumptions for the pitch: 70% of reservation money (the same as
// pricing.ts CPO_SHARE) and 50% of overstay. Refunds, cancellation releases and extensions count as reservation money.
export const CPO_RESERVATION_SHARE = 0.7;
export const CPO_OVERSTAY_SHARE = 0.5;

type Line = { kind: string; cents: number };

// `paidCents` is what the card was really charged (payments.ts Payment.capturedCents): less than the receipt when an
// amount under Stripe's €0.50 minimum was waived. It defaults to the receipt's total, as with demo payments.
// Credits ('credit' lines) are BayWatch's money: the CPO is paid as if the driver had paid by card, so a booking paid
// with credit shows BayWatch's cost as a negative platform share.
export function split(charges: Line[], { paidCents, feeCents }: { paidCents?: number; feeCents?: number } = {}) {
  const sum = (pick: (c: Line) => boolean) => charges.filter(pick).reduce((s, c) => s + c.cents, 0);
  const overstay = sum((c) => c.kind === 'overstay');
  const credit = sum((c) => c.kind === 'credit'); // ≤ 0
  const billed = sum((c) => c.kind !== 'credit'); // what the rules charge, before credits
  const paid = paidCents ?? Math.max(0, billed + credit);
  const fee = feeCents ?? stripeFeeCents(paid);
  // What came in for the rules, by card or credit (nothing when waived); Stripe's fee comes off both shares alike
  const covered = Math.min(billed, paid - credit);
  const factor = billed > 0 ? (covered - fee) / billed : 0;
  const cpoCents = Math.round(((billed - overstay) * CPO_RESERVATION_SHARE + overstay * CPO_OVERSTAY_SHARE) * factor);
  return { paidCents: paid, stripeCents: fee, cpoCents, platformCents: paid - fee - cpoCents, creditCents: Math.abs(credit) };
}
