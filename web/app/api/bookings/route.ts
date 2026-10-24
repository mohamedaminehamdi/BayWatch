import type { NextRequest } from 'next/server';
import { v1View } from '@/lib/legacy';
import { handle, requireUser, schedule } from '@/lib/server';

// ?v=2: { upcoming, active, past, creditCents, firstFree }. Without it, the old Bookings screen's list of past
// bookings in the v1 shape, until that screen goes (then v2 becomes the default and ?v=2 keeps working).
export const GET = (req: NextRequest) =>
  handle(async () => {
    const all = await schedule.bookingsOf(await requireUser());
    return req.nextUrl.searchParams.get('v') === '2' ? all : all.past.map((v) => v1View(v));
  });
