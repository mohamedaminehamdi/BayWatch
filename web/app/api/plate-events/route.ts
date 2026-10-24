import { fail } from '@/lib/reservation';
import { body, direction, handle, reservations, secretOk } from '@/lib/server';

// Camera plate events from the Ecurious server: { plate, direction: 'in' | 'out' }.
// An empty plate means the camera saw a car but couldn't read it.
// ponytail: shared secret only. Use whatever auth the Ecurious server supports once we know it.
export const POST = (req: Request) =>
  handle(async () => {
    if (!secretOk(req.headers.get('x-webhook-secret'))) fail(401, 'Invalid webhook secret');
    const input = await body(req);
    return reservations.plateEvent(input.plate, direction(input.direction));
  });
