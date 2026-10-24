import { berlinTime } from '@/lib/booking-rules';
import type { BayDetail } from '@/lib/booking-types';
import { handle, resolveBay, schedule, viewer } from '@/lib/server';

// One bay, with today's blocks (the viewer's own bookings show as 'mine')
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const bay = await resolveBay((await params).id);
    const detail: BayDetail = { ...schedule.bayView(bay), today: schedule.availability(await viewer(), bay.id, berlinTime(Date.now()).date) };
    return detail;
  });
