import type { NextRequest } from 'next/server';
import { berlinTime } from '@/lib/booking-rules';
import { handle, resolveBay, schedule, viewer } from '@/lib/server';

// ?date=YYYY-MM-DD (Berlin; today by default): the day's 15-min blocks as free, booked, gap, past or mine
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const bay = await resolveBay((await params).id);
    const date = req.nextUrl.searchParams.get('date') ?? berlinTime(Date.now()).date;
    return schedule.availability(await viewer(), bay.id, date);
  });
