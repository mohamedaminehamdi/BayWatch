// Prices and fee wording. The reservation model itself (fees by type and demand, no-show, cancellation,
// overstay, reliability) is in booking-rules.ts; this file adds the app's own prices and turns the rules
// into the receipt lines and sentences drivers see. Amounts are euro cents.

import {
  cancellationFee,
  FREE_CANCEL_MS,
  MAX_RESERVATION_CENTS,
  NO_SHOW_PERCENT,
  noShowFee,
  OVERSTAY_CAP_CENTS,
  OVERSTAY_GRACE_MS,
  TYPES,
  type ReservationType,
} from './booking-rules.ts';

export { FREE_CANCEL_MS, MAX_RESERVATION_CENTS };

// Normal-demand prices, slow (AC) to fast (DC), for copy that isn't about one bay
export const RESERVATION_FROM_CENTS = Math.min(...Object.values(TYPES).map((t) => t.baseCents));
export const RESERVATION_TO_CENTS = Math.max(...Object.values(TYPES).map((t) => t.baseCents));

export const PRICES = {
  // the landing page's headline price: a slow (AC) bay at normal demand. A booking's real fee depends on the
  // bay's type and demand (booking-rules.ts); the landing should move to RESERVATION_FROM/TO_CENTS and feeRules()
  reservation: RESERVATION_FROM_CENTS,
  extension: 50, // "Running late": +5 min on the arrival deadline, once per booking
  bayGuardPerBayMonth: 1900, // CPO plan: blocked-bay alerts + dashboard
};

export const EXTENSION_MS = 5 * 60_000;
export const CPO_SHARE = 0.7; // of reservation revenue; the platform keeps the rest
export const BLOCKED_DC_HOUR_MARGIN = 1200; // estimate: CPO margin lost per hour a DC bay is blocked, for the Bay Guard pitch

export type Charge = { kind: 'reservation' | 'extension' | 'overstay' | 'refund' | 'released'; label: string; cents: number; at: number };

export const total = (charges: Charge[]) => charges.reduce((sum, c) => sum + c.cents, 0);

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const wholeEuro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
// €1.50, but €19 rather than €19.00
export const formatEuro = (cents: number) => (cents % 100 ? euro : wholeEuro).format(cents / 100);

export const FREE_CANCEL_MIN = Math.round(FREE_CANCEL_MS / 60_000);
export const EXTENSION_MIN = Math.round(EXTENSION_MS / 60_000);
const OVERSTAY_GRACE_MIN = Math.round(OVERSTAY_GRACE_MS / 60_000);

// Receipt lines, shared by real bookings and the simulated week
export const CHARGE_LABELS = {
  reservation: (type: ReservationType, demand: string) => `Reservation · ${TYPES[type].label} · ${demand.toLowerCase()} demand`,
  extension: () => `Running late (+${EXTENSION_MIN} min)`,
  refundEarly: () => `Refund: cancelled within ${FREE_CANCEL_MIN} min`,
  refundBlocked: () => 'Refund: the bay was blocked',
  noShowRelease: () => `No-show: ${100 - NO_SHOW_PERCENT}% of the fee returned`,
  cancelRelease: (feeCents: number) => `Cancelled: returned, less the ${formatEuro(feeCents)} cancellation fee`,
  overstay: (minutes: number) => `Overstay: ${minutes} min after the ${OVERSTAY_GRACE_MIN}-min grace`,
};

// What cancelling costs a reserve-now booking once the free minutes are over (start = booking time)
export const cancelAfterFreeCents = (feeCents: number) => cancellationFee(feeCents, { bookedAt: 0, start: 0, cancelledAt: FREE_CANCEL_MS + 1 });

// General rules, for pages that aren't about one booking (the landing page)
export const feeRules = (holdMinutes: number) => ({
  price: `From ${formatEuro(RESERVATION_FROM_CENTS)} at normal demand, never more than ${formatEuro(MAX_RESERVATION_CENTS)}`,
  hold: `Held for ${holdMinutes} minutes while you drive there`,
  cancel: `Free to cancel in the first ${FREE_CANCEL_MIN} minutes, or if another car is blocking the bay`,
  noShow: `Don’t make it? You pay ${NO_SHOW_PERCENT}% of the fee`,
  extend: `Running late? Add ${EXTENSION_MIN} minutes once, for ${formatEuro(PRICES.extension)}`,
});

// The exact fees for one booking, in plain words, shown before the driver pays
export function bookingTerms({ type, feeCents, prepaid, graceMinutes }: { type: ReservationType; feeCents: number; prepaid: boolean; graceMinutes: number }) {
  const t = TYPES[type];
  return {
    arrive: `Arrive within ${graceMinutes} minutes, or the bay is released for other drivers.`,
    noShow: prepaid
      ? `If you don’t arrive, the ${formatEuro(feeCents)} you prepaid isn’t refunded.`
      : `If you don’t arrive, you pay ${NO_SHOW_PERCENT}% of the fee: ${formatEuro(noShowFee(feeCents))}.`,
    cancel: `Cancelling is free for ${FREE_CANCEL_MIN} minutes, or while another car blocks the bay. After that it costs ${formatEuro(cancelAfterFreeCents(feeCents))}.`,
    extend: `Running late? Add ${EXTENSION_MIN} minutes once, for ${formatEuro(PRICES.extension)}.`,
    overstay: `Leave within ${OVERSTAY_GRACE_MIN} minutes of your session’s end. After that, ${formatEuro(t.overstayCentsPerMin)} a minute, at most ${formatEuro(OVERSTAY_CAP_CENTS)}.`,
  };
}
