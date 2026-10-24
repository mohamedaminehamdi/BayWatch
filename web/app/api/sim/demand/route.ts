import { fail } from '@/lib/reservation';
import { body, DEMAND_LEVELS, handle, requireUser, reservations, simulator } from '@/lib/server';

// Demo only (SIMULATOR=1): { level: 'quiet' | 'normal' | 'busy' | 'full' } sets the site's demand, and with it the price
export const POST = (req: Request) =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireUser();
    const { level } = await body(req);
    if (typeof level !== 'string' || !Object.hasOwn(DEMAND_LEVELS, level)) fail(400, 'level must be quiet, normal, busy or full');
    return reservations.setOccupancy(DEMAND_LEVELS[level as keyof typeof DEMAND_LEVELS]);
  });
