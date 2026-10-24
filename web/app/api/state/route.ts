import { appState, handle, viewer } from '@/lib/server';

// Public: bay availability. Personal details only for the signed-in owner.
export const GET = () => handle(async () => appState(await viewer()));
