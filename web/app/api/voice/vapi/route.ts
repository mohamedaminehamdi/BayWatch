import { bays, quote, reserve } from '@/lib/booking';
import { fail } from '@/lib/errors';
import { handle } from '@/lib/server';
import { listVehicles } from '@/lib/vehicles';
import { bearerOk, createVoice } from '@/lib/voice';

// Vapi tool calls for voice booking: quote_reservation and confirm_reservation. Contract: docs/voice-booking.md.
// Vapi sends the bearer secret. Who a call books for comes from the signed session token in the call's
// metadata (the app's mic), or VOICE_DEMO_USER_ID for phone calls: never from the caller or the model.
// Bookings go through the v2 engine with the demo payment: the Baywatch bays only, and "now" can raise a real arm.
const voice = createVoice({
  service: {
    bays,
    quote,
    book: (userId, slot) => reserve(userId, { ...slot, acceptFees: true, payment: 'demo' }),
    vehicle: async (userId) => (await listVehicles(userId))[0] ?? null,
  },
});

export const POST = (req: Request) =>
  handle(async () => {
    if (!bearerOk(req.headers.get('authorization'), process.env.VAPI_BEARER_SECRET)) fail(401, 'Invalid bearer token');
    // not server.ts body(): Vapi's message carries the transcript and assistant config, well over its 10 KB cap.
    // Only an authenticated sender gets this far.
    const payload = await req.json().catch(() => fail(400, 'Invalid JSON'));
    // payment is simulated, so voice booking only runs with VOICE_DEMO=1.
    // Session tokens use their own secret: Vapi holds the bearer secret, so it must not be able to mint tokens.
    return voice.handle(payload, { enabled: process.env.VOICE_DEMO === '1', secret: process.env.VOICE_SESSION_SECRET, demoUserId: process.env.VOICE_DEMO_USER_ID || undefined });
  });
