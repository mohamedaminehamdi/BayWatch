// Booking v2 for server code: the Baywatch bays, a quote cheap enough to call many times in a row (voice), and
// booking with the same checks for everyone. How a booking is paid is always decided here, on the server: the
// web route never passes on a `payment` field from the browser. Bound to the server's engine in booking.ts;
// tests use this factory with fakes.

import type { Bay, ReservationView } from './booking-types.ts';
import { fail } from './errors.ts';
import { claimHold, paymentMode, releaseHold } from './payments.ts';
import type { Schedule } from './schedule.ts';
import type { Vehicle } from './vehicles.ts';

export type BookingRequest = {
  bayId: string;
  start: number;
  blocks: number;
  vehicleId?: string; // one of the driver's cars; omitted: their first car
  priceCents: number; // the price the driver accepted: a different one now is a 409
  acceptFees: true;
  payment?: 'demo'; // voice only, see reserve()
  paymentIntentId?: string; // web, with Stripe keys: the card hold for what the slot costs after credit
};

// Card holds (payments.ts); fakes in tests
export type Payments = {
  mode(): 'stripe' | 'demo';
  claim(id: unknown, hold: { userId: string; cents: number }): Promise<string>;
  release(id: string): Promise<void>;
};
const stripeHolds: Payments = { mode: () => paymentMode(), claim: claimHold, release: releaseHold };

export function bookingApi(schedule: Schedule, vehicles: { list(userId: string): Promise<Vehicle[]> }, payments: Payments = stripeHolds) {
  async function book(userId: string, input: Record<string, unknown>, paymentIntentId?: string) {
    if (input.acceptFees !== true) fail(400, 'Accept the fees to reserve');
    if (typeof input.priceCents !== 'number') fail(400, 'Confirm the price to reserve');
    const bayId = typeof input.bayId === 'string' ? input.bayId : fail(400, 'Choose a bay');
    const cars = await vehicles.list(userId);
    const car = input.vehicleId === undefined ? cars[0] : cars.find((v) => v.id === input.vehicleId);
    if (!car) return input.vehicleId === undefined ? fail(409, 'Add a car to your account to book') : fail(404, 'Car not found');
    return schedule.reserve(userId, {
      bayId,
      start: input.start,
      blocks: input.blocks,
      plate: car.plate,
      vehicleLabel: car.label,
      expectedCents: input.priceCents,
      ...(paymentIntentId && { paymentIntentId }),
    });
  }

  return {
    // The Baywatch bays only (bw-*): directory chargers aren't offered by voice
    bays: (): Pick<Bay, 'id' | 'name' | 'address' | 'class'>[] => schedule.realBays().map(({ id, name, address, class: c }) => ({ id, name, address, class: c })),

    // The grid, the class's length, the 60-day horizon, overlaps with the 10-min gap and the 3-booking limit;
    // no hardware and no Clerk round trip (the credit counts once the driver's wallet is loaded)
    quote(bayId: string, start: number, blocks: number, userId: string): { cents: number; valid: boolean; reason?: string; creditAppliedCents?: number } {
      if (!schedule.bay(bayId)) return { cents: 0, valid: false, reason: 'Unknown bay' };
      const q = schedule.quoteNow(userId, bayId, start, blocks);
      return { cents: q.cents, valid: q.valid, ...(q.reason && { reason: q.reason }), ...(q.creditKnown && { creditAppliedCents: q.creditAppliedCents }) };
    },

    // Voice: the demo payment charges nobody, so it's taken only with VOICE_DEMO=1 or on a server without Stripe
    // keys. Throws { status: 409 } on a taken slot, a changed price or the booking limit, 400 on a bad slot.
    async reserve(userId: string, input: BookingRequest | Record<string, unknown>): Promise<ReservationView> {
      if (input.payment !== 'demo' || (process.env.VOICE_DEMO !== '1' && payments.mode() !== 'demo')) fail(402, 'Pay by card to reserve');
      return book(userId, input);
    },

    // The web (POST /api/reservations). The browser's `payment` field is ignored: without Stripe keys the booking
    // is the demo payment, with them it needs a verified card hold for what the slot costs after credit.
    async reserveFromWeb(userId: string, input: Record<string, unknown>): Promise<ReservationView> {
      if (payments.mode() === 'demo') return book(userId, input);
      const bayId = typeof input.bayId === 'string' ? input.bayId : fail(400, 'Choose a bay');
      const q = await schedule.quoteSlot(userId, bayId, Number(input.start), Number(input.blocks));
      if (q.payCents === 0 || !q.valid) return book(userId, input); // all on credit, or refused before any card is touched
      const hold = await payments.claim(input.paymentIntentId, { userId, cents: q.payCents });
      try {
        return await book(userId, input, hold);
      } catch (e) {
        await payments.release(hold); // no booking, so no hold left on the driver's card
        throw e;
      }
    },
  };
}
