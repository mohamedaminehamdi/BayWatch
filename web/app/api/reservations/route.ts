import { fail } from '@/lib/reservation';
import { body, handle, requireUser, reservations } from '@/lib/server';
import { getVehicle } from '@/lib/vehicles';

// Reserve now: { vehicleId, minutes, priceCents, acceptFees: true, payment: 'demo' }.
// The plate comes from the driver's own car, the session starts now and lasts `minutes`. `priceCents` is the
// fee the driver saw: if demand changed it since, the booking is refused so they can look again.
// Payment is a mock for the prototype: the client must confirm the demo payment step.
export const POST = (req: Request) =>
  handle(async () => {
    const userId = await requireUser();
    const input = await body(req);
    if (input.payment !== 'demo') fail(402, 'Confirm the payment to reserve');
    if (input.acceptFees !== true) fail(400, 'Accept the fees to reserve');
    if (typeof input.priceCents !== 'number') fail(400, 'Confirm the price to reserve');
    const car = await getVehicle(userId, input.vehicleId);
    return reservations.reserve(userId, car.plate, car.label, Number(input.minutes) * 60_000, input.priceCents);
  });
