import { bookingFee, classOf, demandAt, slotProblem } from '@/lib/booking-rules';
import { fail } from '@/lib/errors';
import { handle } from '@/lib/server';
import { bearerOk, createVoice, type BookingService } from '@/lib/voice';

// Vapi tool calls for voice booking: quote_reservation and confirm_reservation. Contract: docs/voice-booking.md.
// Vapi sends the bearer secret. The account is the server-configured demo driver, never the caller or the model.

// ponytail: quotes the first Baywatch bay with the v2 rules and books nothing yet: confirm answers "error"
// until the v2 engine's bays, quote and reserve are plugged in here.
const cls = classOf(Number(process.env.BAY_POWER_KW ?? 200));
const service: BookingService = {
  bays: () => [{ id: 'bw-1', name: 'Baywatch Bay 1', address: process.env.BAY_ADDRESS ?? 'Hackathon venue', class: cls }],
  quote: (_bayId, start, blocks) => {
    const reason = slotProblem(cls, start, blocks, Date.now()) ?? undefined;
    return { cents: bookingFee(cls, demandAt(start)).cents, valid: !reason, reason };
  },
  book: async () => fail(503, 'Voice booking is not connected to the booking engine yet'),
};
const voice = createVoice({ service });

export const POST = (req: Request) =>
  handle(async () => {
    if (!bearerOk(req.headers.get('authorization'), process.env.VAPI_BEARER_SECRET)) fail(401, 'Invalid bearer token');
    const account = process.env.VOICE_DEMO_USER_ID || fail(503, 'VOICE_DEMO_USER_ID is not set');
    // not server.ts body(): Vapi's message carries the transcript and assistant config, well over its 10 KB cap.
    // Only an authenticated sender gets this far.
    const payload = await req.json().catch(() => fail(400, 'Invalid JSON'));
    return voice.handle(payload, account);
  });
