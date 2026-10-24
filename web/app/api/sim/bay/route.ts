import { fail } from '@/lib/errors';
import { assertSimulated, body, handle, requireUser, resolveBay, schedule, simulator } from '@/lib/server';

// Demo only (SIMULATOR=1): { bayId, occupied } puts a car in a simulated bay, or takes it out. Refused (403) for
// bays with a real lock: they only listen to their own camera and sensor.
export const POST = (req: Request) =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireUser();
    const input = await body(req);
    const bay = await resolveBay(String(input.bayId ?? ''));
    assertSimulated(bay);
    await schedule.setOccupied(bay.id, input.occupied === true);
    return schedule.bayView(schedule.bay(bay.id)!);
  });
