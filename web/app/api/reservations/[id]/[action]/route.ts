import { fail } from '@/lib/errors';
import { body, handle, requireUser, schedule } from '@/lib/server';
import { getVehicle } from '@/lib/vehicles';

type Input = Record<string, unknown>;

const actions: Record<string, (userId: string, id: string, input: Input) => unknown> = {
  cancel: (u, id) => schedule.cancel(u, id),
  // "I'm at the bay": { lat, lng } from the browser, used once and not stored. A real lock also needs its camera
  // or sensor to have just seen a car.
  checkin: (u, id, input) => schedule.checkInManually(u, id, input),
  charge: (u, id) => schedule.startCharging(u, id),
  finish: (u, id) => schedule.finish(u, id),
  // different car today: { plate, consent: true } for a one-off plate, or { vehicleId } for another registered car
  plate: async (u, id, input) => {
    if (input.vehicleId !== undefined) {
      const car = await getVehicle(u, input.vehicleId);
      return schedule.setPlate(u, id, { vehicle: { plate: car.plate, label: car.label } });
    }
    if (input.consent !== true) fail(400, 'Agree to plate recognition for this car');
    return schedule.setPlate(u, id, { plate: input.plate });
  },
};

// Only the driver who booked can act on the booking
export const POST = (req: Request, { params }: { params: Promise<{ id: string; action: string }> }) =>
  handle(async () => {
    const userId = await requireUser();
    const { id, action } = await params;
    if (!Object.hasOwn(actions, action)) fail(404, 'Not found');
    return actions[action](userId, id, await body(req));
  });
