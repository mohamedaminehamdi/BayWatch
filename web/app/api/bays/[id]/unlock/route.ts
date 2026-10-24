import { body, handle, requireUser, resolveBay, schedule } from '@/lib/server';
import { listVehicles } from '@/lib/vehicles';

// Walk-up: { lat, lng } at a free bay, used once and not stored. A real lock also needs its camera to have just
// read the plate of one of the driver's cars.
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const userId = await requireUser();
    const bay = await resolveBay((await params).id);
    const cars = bay.lockId ? await listVehicles(userId) : [];
    return schedule.unlock(userId, bay.id, await body(req), cars);
  });
