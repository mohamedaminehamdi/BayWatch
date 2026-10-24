import { fail } from '@/lib/reservation';
import { body, direction, handle, requireUser, reservations, simulator } from '@/lib/server';

// Dev only: lets the demo panel fake camera events. Never set SIMULATOR=1 next to real hardware.
export const POST = (req: Request) =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireUser();
    const input = await body(req);
    return reservations.plateEvent(input.plate, direction(input.direction));
  });
