import * as ecurious from '@/lib/ecurious';
import { fail } from '@/lib/errors';
import { body, handle, hardwareStatus, requireOperator, resolveBay, schedule } from '@/lib/server';

// Recovery: { bayId } lowers that bay's arm by hand, e.g. to let a stuck driver in, or after a command timed out.
// A booking in progress isn't changed. The adapter's error comes back as a 502.
export const POST = (req: Request) =>
  handle(async () => {
    await requireOperator();
    const input = await body(req);
    const bay = await resolveBay(typeof input.bayId === 'string' ? input.bayId : fail(400, 'bayId is required: which bay’s arm to lower'));
    const lockId = bay.lockId ?? fail(409, `${bay.name} has no lock to lower`);
    try {
      await ecurious.lower(lockId);
    } catch (e) {
      schedule.note('hardware', `an operator could not lower the arm: ${(e as Error).message}`, bay.id);
      fail(502, (e as Error).message);
    }
    schedule.note('hardware', 'an operator lowered the arm', bay.id);
    return { hardware: await hardwareStatus(bay.id) };
  });
