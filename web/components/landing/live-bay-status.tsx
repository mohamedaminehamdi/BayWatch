'use client';

import { useEffect, useState } from 'react';
import type { Bay } from '@/lib/booking-types';

// The Baywatch bays' status, straight from the public API. Hidden if the API can't be reached.
export function LiveBayStatus() {
  const [bays, setBays] = useState<Bay[] | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/state')
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => setBays(s?.realBays ?? null), () => setBays(null));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!bays?.length) return <span className="block h-5" />;

  // green: free and can be unlocked now, like the bays' LED. An ink dot with a lime halo (lime alone vanishes on paper).
  const free = bays.filter((b) => b.led === 'green').length;
  const [dot, ping] = free ? ['bg-ink', 'bg-signal'] : ['bg-danger', 'bg-danger'];

  return (
    <p aria-live="polite" className="inline-flex items-center gap-2.5 font-mono text-[0.8125rem] uppercase leading-snug tracking-[0.1em] text-muted">
      <span className="relative flex size-2.5 shrink-0">
        <span className={`absolute inset-0 animate-ping rounded-full opacity-70 ${ping}`} />
        <span className={`relative size-2.5 rounded-full ${dot}`} />
      </span>
      <span>
        Live:{' '}
        <span className="font-semibold text-ink">
          {free} of {bays.length}
        </span>{' '}
        Baywatch bays free right now
      </span>
    </p>
  );
}
