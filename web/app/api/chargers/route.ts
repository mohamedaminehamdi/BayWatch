import type { NextRequest } from 'next/server';
import { chargers } from '@/lib/goingelectric';
import { handle } from '@/lib/server';

export const GET = (req: NextRequest) => handle(() => chargers(req.nextUrl.searchParams));
