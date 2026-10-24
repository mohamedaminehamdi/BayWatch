import { handle, requireUser, schedule } from '@/lib/server';

// The driver's own booking; anyone else's doesn't exist for them (404)
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => schedule.get(await requireUser(), (await params).id));
