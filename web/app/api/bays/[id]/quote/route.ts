import type { NextRequest } from 'next/server';
import { fail } from '@/lib/errors';
import { handle, resolveBay, schedule, viewer } from '@/lib/server';

// ?start=<ms>&blocks=<n>: the fee, whether the slot can be booked (and why not), the cancellation schedule,
// and the credit the viewer's next booking would use
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const bay = await resolveBay((await params).id);
    const q = req.nextUrl.searchParams;
    const start = Number(q.get('start'));
    const blocks = Number(q.get('blocks'));
    if (!q.get('start') || !Number.isFinite(start) || !q.get('blocks') || !Number.isFinite(blocks)) fail(400, 'start (ms) and blocks are required');
    return schedule.quoteSlot(await viewer(), bay.id, start, blocks);
  });
