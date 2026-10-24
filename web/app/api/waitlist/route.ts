import { legacyWaitlist } from '@/lib/legacy';
import { handle, requireUser } from '@/lib/server';

// The old "Notify me when free" button (deprecated): with booking ahead there's nothing to wait for, so this only
// remembers the choice for the old screen
export const POST = () =>
  handle(async () => {
    legacyWaitlist.add(await requireUser());
    return { position: 1 };
  });

export const DELETE = () =>
  handle(async () => {
    legacyWaitlist.delete(await requireUser());
    return { ok: true };
  });
