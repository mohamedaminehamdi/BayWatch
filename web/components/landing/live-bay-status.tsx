'use client';

import { useEffect, useState } from 'react';
import type { AppState } from '@/lib/server';

// The real test bay's status, straight from the public API. Hidden if the API can't be reached.
export function LiveBayStatus() {
  const [s, setS] = useState<AppState | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/state')
        .then((r) => (r.ok ? r.json() : null))
        .then(setS, () => setS(null));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!s) return <span className="block h-5" />;

  // free: an ink dot with a lime halo (lime alone vanishes on paper); taken: warn orange
  const [label, dot, ping] = s.blockedSince
    ? ['a car is in the bay', 'bg-warn', 'bg-warn']
    : s.reservation
      ? [s.reservation.status === 'reserved' ? 'reserved right now' : 'in use right now', 'bg-warn', 'bg-warn']
      : s.priority
        ? ['held for a waiting driver', 'bg-warn', 'bg-warn']
        : ['free right now', 'bg-ink', 'bg-signal'];

  return (
    <p aria-live="polite" className="inline-flex items-center gap-2.5 font-mono text-[0.8125rem] uppercase leading-snug tracking-[0.1em] text-muted">
      <span className="relative flex size-2.5 shrink-0">
        <span className={`absolute inset-0 animate-ping rounded-full opacity-70 ${ping}`} />
        <span className={`relative size-2.5 rounded-full ${dot}`} />
      </span>
      <span>
        Live: <span className="font-semibold text-ink">{s.bay.name}</span> is {label}
      </span>
    </p>
  );
}
