import { fail } from '@/lib/reservation';
import { body, handle, requireUser, reservations } from '@/lib/server';

type Input = Record<string, unknown>;

const actions: Record<string, (userId: string, input: Input) => unknown> = {
  cancel: (u) => reservations.cancel(u),
  charge: (u) => reservations.startCharging(u),
  finish: (u) => reservations.finish(u),
  extend: (u) => reservations.extend(u),
  // fallback check-in: { lat, lng } from the browser, used once and not stored
  checkin: (u, input) => reservations.checkInManually(u, input),
  // different car today: { plate, consent: true }
  'other-plate': (u, input) =>
    input.consent === true ? reservations.useOtherPlate(u, input.plate) : fail(400, 'Agree to plate recognition for this car'),
};

// Only the driver who reserved can act on the reservation
export const POST = (req: Request, ctx: RouteContext<'/api/reservation/[action]'>) =>
  handle(async () => {
    const userId = await requireUser();
    const { action } = await ctx.params;
    if (!Object.hasOwn(actions, action)) fail(404, 'Not found');
    return actions[action](userId, await body(req));
  });
