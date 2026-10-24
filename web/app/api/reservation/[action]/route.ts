import { fail } from '@/lib/errors';
import { v1View } from '@/lib/legacy';
import { body, handle, requireUser, schedule } from '@/lib/server';

type Input = Record<string, unknown>;

// The old booking screen's actions (deprecated): on the driver's current booking, in the v1 shape
const actions: Record<string, (userId: string, id: string, input: Input) => unknown> = {
  cancel: async (u, id) => v1View(await schedule.cancel(u, id)),
  charge: (u, id) => v1View(schedule.startCharging(u, id)),
  finish: (u, id) => v1View(schedule.finish(u, id)),
  checkin: async (u, id, input) => v1View(await schedule.checkInManually(u, id, input)),
  'other-plate': (u, id, input) =>
    input.consent === true ? v1View(schedule.setPlate(u, id, { plate: input.plate })) : fail(400, 'Agree to plate recognition for this car'),
  extend: () => fail(409, 'Running late? There’s no +5 min any more: the booking keeps the 15-minute arrival grace. Book a later slot instead.'),
};

export const POST = (req: Request, ctx: RouteContext<'/api/reservation/[action]'>) =>
  handle(async () => {
    const userId = await requireUser();
    const { action } = await ctx.params;
    if (!Object.hasOwn(actions, action)) fail(404, 'Not found');
    const current = schedule.current(userId) ?? fail(409, 'No booking in progress');
    return actions[action](userId, current.booking.id, await body(req));
  });
