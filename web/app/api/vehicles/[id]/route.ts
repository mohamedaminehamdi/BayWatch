import { handle, requireUser } from '@/lib/server';
import { removeVehicle } from '@/lib/vehicles';

export const DELETE = (req: Request, ctx: RouteContext<'/api/vehicles/[id]'>) =>
  handle(async () => removeVehicle(await requireUser(), (await ctx.params).id));
