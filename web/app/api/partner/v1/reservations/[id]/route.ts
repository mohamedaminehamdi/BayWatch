import { partnerBay, partnerRoute, reservationStatus } from '@/lib/partners';
import { reservations } from '@/lib/server';

// A partner's own reservation, by its OCPI reservation_id: status, arrival deadline, fees.
// The polling alternative to OCPI CommandResult callbacks. Partner guide: docs/api.md
export const GET = (req: Request, ctx: RouteContext<'/api/partner/v1/reservations/[id]'>) =>
  partnerRoute(req, async (partner) => reservationStatus(partner, (await ctx.params).id, partnerBay(reservations)));
