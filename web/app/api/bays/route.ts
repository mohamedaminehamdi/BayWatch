import type { NextRequest } from 'next/server';
import { geBay } from '@/lib/bays';
import type { BaysResponse } from '@/lib/booking-types';
import { chargers } from '@/lib/goingelectric';
import { handle, schedule } from '@/lib/server';

// Map search: ?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]. `bays` are the GoingElectric chargers in the box, every
// one bookable; `realBays` are the Baywatch bays, always, whatever the box.
export const GET = (req: NextRequest) =>
  handle(async () => {
    const found = await chargers(req.nextUrl.searchParams);
    const res: BaysResponse & { warning?: string; more?: boolean } = {
      bays: found.chargers.map((c) => schedule.bayView(schedule.knowBay(geBay(c)))),
      realBays: schedule.realBays().map(schedule.bayView),
      ...(found.warning && { warning: found.warning }),
      ...(found.more && { more: true }),
    };
    return res;
  });
