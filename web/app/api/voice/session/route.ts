import { fail } from '@/lib/errors';
import { handle, requireUser } from '@/lib/server';
import { signVoiceToken } from '@/lib/voice';

// The app's mic: a 15-minute token naming the signed-in driver. The app passes it as the call's metadata
// (`assistantOverrides.metadata.voiceToken`), and /api/voice/vapi books for that driver.
export const POST = () =>
  handle(async () => {
    const userId = await requireUser();
    if (process.env.VOICE_DEMO !== '1') fail(503, 'Voice booking is switched off');
    return signVoiceToken(userId, process.env.VAPI_BEARER_SECRET, Date.now()) ?? fail(503, 'Voice booking is not configured');
  });
