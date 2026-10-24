import { handle, requireOperator, schedule } from '@/lib/server';

// The operator confirms the bay is clear: the waiting driver's booking carries on and the plate is erased
export const POST = (req: Request, ctx: RouteContext<'/api/operator/alerts/[id]/resolve'>) =>
  handle(async () => {
    await requireOperator();
    return schedule.resolveAlert((await ctx.params).id);
  });
