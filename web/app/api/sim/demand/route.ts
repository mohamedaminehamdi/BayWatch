import type { DemandLevel } from '@/lib/booking-types';
import { fail } from '@/lib/errors';
import { body, handle, requireUser, schedule, simulator } from '@/lib/server';

const LEVELS: DemandLevel[] = ['quiet', 'normal', 'busy', 'full'];

// Demo only (SIMULATOR=1): { level: 'quiet' | 'normal' | 'busy' | 'full' } overrides demand everywhere, and with it
// the price; { level: null } goes back to the time of day
export const POST = (req: Request) =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireUser();
    const { level } = await body(req);
    if (level !== null && !LEVELS.includes(level as DemandLevel)) fail(400, 'level must be quiet, normal, busy, full or null');
    schedule.setDemand(level as DemandLevel | null);
    return { demand: schedule.demand() };
  });
