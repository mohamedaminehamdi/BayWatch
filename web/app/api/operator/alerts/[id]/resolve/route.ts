import { handle, requireOperator, reservations } from '@/lib/server';

// The operator confirms the bay is clear: the waiting driver's hold resumes and the plate is erased
export const POST = (req: Request, ctx: RouteContext<'/api/operator/alerts/[id]/resolve'>) =>
  handle(async () => {
    await requireOperator();
    return reservations.resolveAlert((await ctx.params).id);
  });
