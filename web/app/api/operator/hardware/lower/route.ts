import * as ecurious from '@/lib/ecurious';
import { fail } from '@/lib/reservation';
import { handle, hardwareStatus, requireOperator, reservations } from '@/lib/server';

// Recovery: lower the arm by hand, e.g. after a reserve command timed out and the arm may be up with no
// booking. A booking in progress isn't changed. The adapter's error comes back as a 502.
export const POST = () =>
  handle(async () => {
    await requireOperator();
    try {
      await ecurious.release();
    } catch (e) {
      reservations.note('hardware', `an operator could not lower the arm: ${(e as Error).message}`);
      fail(502, (e as Error).message);
    }
    reservations.note('hardware', 'an operator lowered the arm');
    return { hardware: await hardwareStatus() };
  });
