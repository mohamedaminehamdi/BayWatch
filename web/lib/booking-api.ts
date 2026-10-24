// Booking v2 for in-process callers on the server that have no Clerk session (voice, for its configured demo
// driver): the Baywatch bays, a quote cheap enough to call many times in a row, and a booking with the same
// checks as POST /api/reservations. Bound to the server's engine in booking.ts; this factory is what tests use.

import type { Bay, ReservationView } from './booking-types.ts';
import { fail } from './errors.ts';
import type { Schedule } from './schedule.ts';
import type { Vehicle } from './vehicles.ts';

export type BookingRequest = {
  bayId: string;
  start: number;
  blocks: number;
  vehicleId?: string; // one of the driver's cars; omitted: their first car
  priceCents: number; // the price the driver accepted: a different one now is a 409
  acceptFees: true;
  payment: 'demo'; // simulated: never reaches Stripe
};

export function bookingApi(schedule: Schedule, vehicles: { list(userId: string): Promise<Vehicle[]> }) {
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

    // Throws { status: 409 } on a taken slot, a changed price or the booking limit, 400 on a bad slot
    async reserve(userId: string, input: BookingRequest | Record<string, unknown>): Promise<ReservationView> {
      if (input.payment !== 'demo') fail(402, 'Confirm the payment to reserve');
      if (input.acceptFees !== true) fail(400, 'Accept the fees to reserve');
      if (typeof input.priceCents !== 'number') fail(400, 'Confirm the price to reserve');
      const bayId = typeof input.bayId === 'string' ? input.bayId : fail(400, 'Choose a bay');
      const cars = await vehicles.list(userId);
      const car = input.vehicleId === undefined ? cars[0] : cars.find((v) => v.id === input.vehicleId);
      if (!car) return input.vehicleId === undefined ? fail(409, 'Add a car to your account to book') : fail(404, 'Car not found');
      return schedule.reserve(userId, { bayId, start: input.start, blocks: input.blocks, plate: car.plate, vehicleLabel: car.label, expectedCents: input.priceCents });
    },
  };
}
