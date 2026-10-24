'use client';

import type Vapi from '@vapi-ai/web';
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Book by voice (docs/voice-booking.md). The signed-in driver's session token from /api/voice/session goes into
// the call's metadata, where the assistant can't see it, and the webhook books for that driver.
// Hidden unless the Vapi public key and assistant are set.
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

type Phase = 'idle' | 'starting' | 'live';

export function MicButton() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const vapi = useRef<Vapi | null>(null);

  useEffect(() => {
    const call = vapi;
    return () => void call.current?.stop(); // leaving the app ends the call
  }, []);

  if (!PUBLIC_KEY || !ASSISTANT_ID) return null;

  async function start() {
    setPhase('starting');
    setNote({ text: 'Starting voice booking…' });
    try {
      const res = await fetch('/api/voice/session', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Voice booking is unavailable');
      if (!vapi.current) {
        const { default: VapiClient } = await import('@vapi-ai/web'); // loaded on the first tap only
        const v = new VapiClient(PUBLIC_KEY!);
        v.on('call-start', () => {
          setPhase('live');
          setNote({ text: 'Listening. Say where, when and for how long you want to charge.' });
        });
        v.on('call-end', () => {
          setPhase('idle');
          setNote({ text: 'Voice booking ended.' });
        });
        v.on('error', () => {
          setPhase('idle');
          setNote({ text: 'The voice call dropped. Tap the mic to try again.', error: true });
        });
        vapi.current = v;
      }
      await vapi.current.start(ASSISTANT_ID, { metadata: { voiceToken: body.token } });
    } catch (e) {
      setPhase('idle');
      setNote({ text: e instanceof Error ? e.message : 'Voice booking is unavailable', error: true });
    }
  }

  async function stop() {
    await vapi.current?.stop();
    setPhase('idle');
  }

  const live = phase === 'live';
  return (
    <div className="relative">
      <button
        type="button"
        onClick={live ? stop : start}
        disabled={phase === 'starting'}
        aria-busy={phase === 'starting' || undefined}
        aria-pressed={live}
        aria-label={live ? 'End voice booking' : 'Book by voice'}
        title={live ? 'End voice booking' : 'Book by voice'}
        className={`inline-flex size-11 items-center justify-center rounded-full ring-1 ring-inset transition-colors disabled:opacity-55 ${
          live ? 'bg-signal text-ink ring-transparent hover:bg-signal-strong' : 'bg-surface text-ink ring-line-strong hover:ring-ink'
        }`}
      >
        {phase === 'starting' ? (
          <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : live ? (
          <Square aria-hidden className="size-4 fill-current" />
        ) : (
          <Mic aria-hidden className="size-5" />
        )}
      </button>
      {/* status changes are announced; only errors are shown, so the header stays quiet */}
      <p role="status" className={note?.error ? 'absolute right-0 top-full z-10 mt-2 w-64 rounded-lg bg-ink px-3 py-2 text-xs text-page shadow-lg' : 'sr-only'}>
        {note?.text}
      </p>
    </div>
  );
}
