import { body, handle, requireUser } from '@/lib/server';
import { addVehicle, listVehicles } from '@/lib/vehicles';

export const GET = () => handle(async () => listVehicles(await requireUser()));

export const POST = (req: Request) => handle(async () => addVehicle(await requireUser(), await body(req)));
