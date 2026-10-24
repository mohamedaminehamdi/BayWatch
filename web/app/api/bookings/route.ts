import { handle, requireUser, reservations } from '@/lib/server';

export const GET = () => handle(async () => reservations.bookings(await requireUser()));
