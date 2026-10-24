import { fail } from '@/lib/errors';
import { LEGACY_BAY } from '@/lib/legacy';
import { assertSimulated, body, direction, handle, resolveBay, schedule, secretOk } from '@/lib/server';

// Camera events from another camera source: { bayId, plate, direction: 'in' | 'out' }. An empty plate means the
// camera saw a car but couldn't read it. Bays with a real Ecurious lock only take their own camera (the event
// stream), so they refuse these (403).
// ponytail: shared secret only. Use whatever auth the camera source supports once we know it.
export const POST = (req: Request) =>
  handle(async () => {
    if (!secretOk(req.headers.get('x-webhook-secret'))) fail(401, 'Invalid webhook secret');
    const input = await body(req);
    const bay = await resolveBay(typeof input.bayId === 'string' ? input.bayId : LEGACY_BAY);
    assertSimulated(bay);
    if (direction(input.direction) === 'out') {
      await schedule.vacated(bay.id);
      return { matched: false };
    }
    return schedule.plateEvent(bay.id, input.plate);
  });
