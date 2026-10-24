import { partnerBay, partnerRoute, runCommand } from '@/lib/partners';
import { body, reservations } from '@/lib/server';

// OCPI 2.2.1 Commands, receiver side: RESERVE_NOW and CANCEL_RESERVATION from partner apps (eMSPs),
// answered synchronously in the OCPI envelope. Partner guide: docs/api.md · spec: /openapi.json
export const POST = (req: Request, ctx: RouteContext<'/ocpi/2.2.1/commands/[command]'>) =>
  partnerRoute(req, async (partner) => runCommand(partner, (await ctx.params).command, () => body(req), partnerBay(reservations)));
