import { handle, requireUser, reservations } from '@/lib/server';

// "Notify me when free": join or leave the queue for the bay
export const POST = () => handle(async () => reservations.notifyWhenFree(await requireUser()));

export const DELETE = () => handle(async () => reservations.leaveWaitlist(await requireUser()));
