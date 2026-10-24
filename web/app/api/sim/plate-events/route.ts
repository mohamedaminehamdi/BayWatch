import { fail } from '@/lib/errors';
import { LEGACY_BAY } from '@/lib/legacy';
import { assertSimulated, body, direction, handle, requireUser, resolveBay, schedule, simulator } from '@/lib/server';

// Demo only (SIMULATOR=1): { bayId, plate, direction } fakes what a camera sees. Refused (403) for bays with a real
// lock. Without bayId (the old demo panel): Baywatch Bay 1.
export const POST = (req: Request) =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireUser();
    const input = await body(req);
    const bay = await resolveBay(typeof input.bayId === 'string' ? input.bayId : LEGACY_BAY);
    assertSimulated(bay);
    if (direction(input.direction) === 'out') {
      await schedule.vacated(bay.id);
      return { matched: false };
    }
    return schedule.plateEvent(bay.id, input.plate);
  });
