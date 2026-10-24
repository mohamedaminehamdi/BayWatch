'use client';

import { ArrowLeft, CarFront, ExternalLink, FlaskConical, LockOpen, Navigation, TriangleAlert, WifiOff, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { formatTime, useNow } from '@/components/time';
import { Button, buttonClass, chipClass } from '@/components/ui/button';
import { Led } from '@/components/ui/led';
import type { Bay, Quote, ReservationView, UnlockRequest } from '@/lib/booking-types';
import { BLOCK_MS, CLASSES, MIN_GAP_MS, nowSlot } from '@/lib/booking-rules';
import { directionsUrl, formatDistance } from '@/lib/geo';
import { formatEuro } from '@/lib/pricing';

export type Row = { bay: Bay; distance: number | null };

export const OFFLINE_TEXT = 'The bay is offline right now. Try again in a few minutes.';
// The three Baywatch bays say honestly whether a real barrier stands behind them
export const hardwareNote = (b: Bay) => (b.guard === 'hardware' ? 'Real barrier' : b.real ? 'No hardware assigned yet' : 'Demo: simulated guard');

// What the bay is doing, in words: the LED is never the only sign
const STATUS = {
  free: { label: 'Free', tone: 'bg-brand-tint text-brand-strong' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn' },
  offline: { label: 'Offline', tone: 'bg-warn-tint text-warn' },
} as const;

// A walk-up can run until the next booking's start, less the gap; with nothing booked, all day
export const freeUntil = (b: Bay) => (b.nextBookingAt ? formatTime(b.nextBookingAt - MIN_GAP_MS) : null);

export function BayList({
  realBays,
  rows,
  fromYou,
  more,
  note,
  onSelect,
  onBook,
}: {
  realBays: Bay[];
  rows: Row[];
  fromYou: boolean;
  more: boolean;
  note: string;
  onSelect: (id: string) => void;
  onBook: (bay: Bay) => void;
}) {
  return (
    <div>
      <h2 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Demo bays</h2>
      <ul className="mt-3 grid gap-2.5">
        {realBays.map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-2xl bg-brand-deep p-3 pl-4 text-on-brand">
            <button type="button" onClick={() => onSelect(b.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-surface">
                <Zap aria-hidden className="size-5 fill-current" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-2xl leading-none tracking-[0.012em]">{b.name}</span>
                <span className="mt-1.5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-on-brand-muted">
                  {b.status !== 'offline' && <Led led={b.led} onDark />}
                  {STATUS[b.status].label} · {b.powerKw} kW · from {formatEuro(b.priceFromCents)}
                </span>
                <span className="mt-1 block font-mono text-xs uppercase tracking-[0.08em] text-on-brand-accent">{hardwareNote(b)}</span>
              </span>
            </button>
            <Button variant="signal" size="sm" disabled={b.status === 'offline'} onClick={() => onBook(b)} aria-label={`Book ${b.name} now`}>
              Book now
            </Button>
          </li>
        ))}
        {!realBays.length && <li className="rounded-2xl bg-sunken px-4 py-3 text-sm text-muted">The demo bays aren’t reachable right now.</li>}
      </ul>

      <h2 className="mt-7 flex items-baseline justify-between gap-3 text-sm text-muted">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.12em]">Chargers nearby</span>
        <span className="text-right">{fromYou ? 'Nearest to you' : 'Nearest to the map centre'}</span>
      </h2>
      {note && <p className="mt-3 rounded-2xl bg-sunken px-4 py-3 text-sm text-muted">{note}</p>}
      <ul className="mt-2 divide-y divide-line">
        {rows.map(({ bay: b, distance }) => (
          <li key={b.id} className="flex items-center gap-3 py-2">
            <button type="button" onClick={() => onSelect(b.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left hover:bg-sunken/60">
              {b.status === 'offline' ? <WifiOff aria-label="Offline" className="size-3.5 shrink-0 text-danger" /> : <Led led={b.led} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{b.name}</span>
                <span className="block truncate font-mono text-[0.8125rem] text-muted">
                  {b.status !== 'free' && <span className="font-semibold text-warn">{STATUS[b.status].label} · </span>}
                  {b.powerKw} kW · {CLASSES[b.class].label} · from {formatEuro(b.priceFromCents)}
                  {distance !== null && ` · ${formatDistance(distance)}`}
                </span>
              </span>
            </button>
            <Button variant="secondary" size="sm" disabled={b.status === 'offline'} onClick={() => onBook(b)} aria-label={`Book ${b.name} now`}>
              Book now
            </Button>
          </li>
        ))}
      </ul>
      {more && <p className="mt-3 text-sm text-muted">Showing the nearest 50. Zoom in to see the rest.</p>}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="-ml-2 mb-3 flex min-h-11 w-fit items-center gap-1.5 rounded-full px-3 font-semibold text-muted hover:bg-sunken hover:text-ink">
      <ArrowLeft aria-hidden className="size-4" /> All chargers
    </button>
  );
}

// Any bay, real or GoingElectric: what it is, the LED, Book, Navigate, and walk-up when it's green
export function BayPanel({ bay: b, distance, onBack, onBook }: { bay: Bay; distance: number | null; onBack: () => void; onBook: (bay: Bay) => void }) {
  const router = useRouter();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');
  const offline = b.status === 'offline';
  const s = STATUS[b.status];
  const until = freeUntil(b);
  const canWalkUp = b.led === 'green' && b.status === 'free';

  // "Book now" books this moment, from the block under way for at least an hour (nowSlot): the button says until
  // when, and the fee
  const now = useNow();
  const slot = now ? nowSlot(b.class, now) : null;
  const start = slot?.start ?? null;
  const key = `${b.id}:${start}:${b.priceFromCents}`; // a new block or demand level can change the price
  const [fee, setFee] = useState<{ key: string; cents: number } | null>(null);
  useEffect(() => {
    if (start === null) return;
    let live = true;
    api<Quote>('GET', `/api/bays/${encodeURIComponent(b.id)}/quote?start=now`).then(
      (q) => live && setFee({ key, cents: q.cents }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [b.id, start, key]);

  // walk-up needs evidence of being at the bay: the geofence (and, at real bays, the camera seeing the car)
  function unlock() {
    if (!navigator.geolocation) return setError('Your browser can’t share its location, which unlocking needs.');
    setUnlocking(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const body: UnlockRequest = { lat: p.coords.latitude, lng: p.coords.longitude };
          const r = await api<ReservationView>('POST', `/api/bays/${encodeURIComponent(b.id)}/unlock`, body);
          router.push(`/booking/${encodeURIComponent(r.id)}`);
        } catch (e) {
          setError((e as Error).message);
          setUnlocking(false);
        }
      },
      () => {
        setUnlocking(false);
        setError('Allow location access so we can check you’re at the bay.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${chipClass} ${s.tone}`}>
          {!offline && <Led led={b.led} />}
          {s.label}
        </span>
        {b.real && <span className={`${chipClass} ${b.guard === 'hardware' ? 'bg-sunken text-ink' : 'bg-accent-tint text-accent'}`}>{hardwareNote(b)}</span>}
      </div>
      {b.network && <p className="mt-4 font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">{b.network}</p>}
      <h2 className="mt-2 font-display text-4xl leading-[0.95] tracking-[0.012em]">{b.name}</h2>
      <p className="mt-1 text-muted">
        {b.address}
        {distance !== null && ` · ${formatDistance(distance)} away`}
      </p>

      <ul className="mt-5 grid gap-2">
        {b.points.map((p, i) => (
          <li key={i} className="flex items-center justify-between rounded-lg bg-sunken px-4 py-3">
            <span className="font-medium">
              {p.count}× {p.type}
            </span>
            <span className="font-mono text-muted">{p.power} kW</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm text-muted">
        {CLASSES[b.class].label}: from <span className="font-mono font-semibold text-ink">{formatEuro(b.priceFromCents)}</span> to reserve; the fee is set by
        demand when you book.
        {b.guard === 'simulated' && (b.real ? ' No hardware is assigned to this bay yet, so its guard is simulated.' : ' This charger’s guard is simulated for the demo.')}
      </p>

      {offline && (
        <p role="status" className="mt-4 flex gap-3 rounded-2xl bg-warn-tint p-4 font-semibold text-ink">
          <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          {OFFLINE_TEXT}
        </p>
      )}
      {b.status === 'occupied' && (
        <p role="status" className="mt-4 flex gap-3 rounded-2xl bg-warn-tint p-4 text-ink">
          <CarFront aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <span>
            <span className="font-semibold">A car is in the bay right now.</span> You can still book a later start.
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="lg" disabled={offline} onClick={() => onBook(b)} className="w-full">
          {slot === null ? 'Book now' : `Book now · until ${formatTime(slot.start + slot.blocks * BLOCK_MS)}${fee?.key === key ? ` · ${formatEuro(fee.cents)}` : ''}`}
        </Button>
        <a href={directionsUrl(b)} target="_blank" rel="noopener" className={buttonClass('secondary', 'lg')}>
          <Navigation aria-hidden className="size-5" /> Navigate by car
        </a>
      </div>

      {canWalkUp && (
        <div className="mt-6 rounded-2xl bg-brand-tint p-4">
          <Button variant="secondary" size="lg" loading={unlocking} onClick={unlock} className="w-full whitespace-normal!">
            <LockOpen aria-hidden className="size-5" /> {until ? `Unlock now: free until ${until}` : 'Unlock now: nothing booked after you'}
          </Button>
          <p className="mt-2 text-sm text-ink">
            No booking needed while it’s green. You need to be at the bay{b.real ? ', with your car in front of the camera' : ''}.
          </p>
        </div>
      )}

      {b.url && (
        <a href={b.url} target="_blank" rel="noopener" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline underline-offset-2 hover:text-ink">
          This charger on GoingElectric <ExternalLink aria-hidden className="size-4" />
        </a>
      )}

      {b.guard === 'simulated' && (
        <p className="mt-4 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-accent">
          <FlaskConical aria-hidden className="size-3.5" /> {hardwareNote(b)}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 flex gap-3 rounded-2xl bg-danger-tint p-4 text-danger">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
