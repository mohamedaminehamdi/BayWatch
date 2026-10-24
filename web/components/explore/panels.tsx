'use client';

import { ArrowLeft, BellRing, CarFront, Clock, ExternalLink, Navigation, ShieldCheck, TriangleAlert, WifiOff, Zap } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { formatCountdown, formatTime, useNow } from '@/components/time';
import { Button, buttonClass, chipClass } from '@/components/ui/button';
import { Led } from '@/components/ui/led';
import type { Bay } from '@/lib/booking-types';
import { directionsUrl, formatDistance } from '@/lib/geo';
import type { Charger } from '@/lib/goingelectric';
import { formatEuro, FREE_CANCEL_MIN } from '@/lib/pricing';
import { OVERSTAY_GRACE_MS } from '@/lib/booking-rules';
import { ACTIVE } from '@/lib/reservation';
import type { AppState } from '@/lib/server';

export const maxPower = (c: Charger) => Math.max(0, ...c.points.map((p) => p.power));

export type Row = { charger: Charger; distance: number | null };

// What the bay is doing right now, in one word the list and marker can share
export function bayAvailability(s: AppState) {
  const r = s.reservation;
  if (r?.mine && ACTIVE.has(r.status)) return 'mine' as const;
  if (s.blockedSince) return 'occupied' as const;
  if (r && ACTIVE.has(r.status)) return r.status === 'reserved' ? ('reserved' as const) : ('in_use' as const);
  if (s.priority && !s.priority.mine) return 'held' as const;
  return 'free' as const;
}

// The guard can't be raised while the device is offline, so nobody can reserve. `online` is unset on the mock.
export const bayOffline = (s: AppState) => s.hardware.online === false;
export const OFFLINE_TEXT = 'The bay is offline right now. Try again in a few minutes.';

const AVAILABILITY = {
  mine: { label: 'Booked by you', tone: 'bg-brand-tint text-brand-strong' },
  free: { label: 'Free · reservable', tone: 'bg-brand-tint text-brand-strong' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn' },
  in_use: { label: 'In use', tone: 'bg-warn-tint text-warn' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn' },
  held: { label: 'Held for a waiting driver', tone: 'bg-warn-tint text-warn' },
};

// The three Baywatch bays say honestly whether a real barrier stands behind them
export const hardwareNote = (b: Bay) => (b.guard === 'hardware' ? 'Real barrier' : b.real ? 'No hardware assigned yet' : 'Demo: simulated guard');
// What a Baywatch bay is doing, in words: the LED is never the only sign
const BAY_STATUS = {
  free: { label: 'Free', tone: 'bg-brand-tint text-brand-strong' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn' },
  offline: { label: 'Offline', tone: 'bg-warn-tint text-warn' },
} as const;

export function ChargerList({
  realBays,
  mineId,
  fromYou,
  rows,
  more,
  note,
  onSelectBay,
  onBook,
  onSelect,
}: {
  realBays: Bay[];
  mineId: string | null;
  fromYou: boolean;
  rows: Row[];
  more: boolean;
  note: string;
  onSelectBay: (id: string) => void;
  onBook: (id: string) => void;
  onSelect: (id: number) => void;
}) {
  return (
    <div>
      <h2 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Demo bays</h2>
      <ul className="mt-3 grid gap-2.5">
        {realBays.map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-2xl bg-brand-deep p-3 pl-4 text-on-brand">
            <button type="button" onClick={() => onSelectBay(b.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-surface">
                <Zap aria-hidden className="size-5 fill-current" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-2xl leading-none tracking-[0.012em]">{b.name}</span>
                <span className="mt-1.5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-on-brand-muted">
                  {b.status !== 'offline' && <Led led={b.led} onDark />}
                  {b.id === mineId ? 'Booked by you' : BAY_STATUS[b.status].label} · {b.powerKw} kW · from {formatEuro(b.priceFromCents)}
                </span>
                <span className="mt-1 block font-mono text-xs uppercase tracking-[0.08em] text-on-brand-accent">{hardwareNote(b)}</span>
              </span>
            </button>
            <Button variant="signal" size="sm" disabled={b.status === 'offline'} onClick={() => onBook(b.id)} aria-label={`Book ${b.name} now`}>
              Book now
            </Button>
          </li>
        ))}
        {!realBays.length && <li className="rounded-2xl bg-sunken px-4 py-3 text-sm text-muted">The demo bays aren’t reachable right now.</li>}
      </ul>

      <h2 className="mt-6 flex items-baseline justify-between gap-3 text-sm text-muted">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.12em]">Public chargers nearby</span>
        <span className="text-right">{fromYou ? 'Nearest to you' : 'Nearest to the map centre'}</span>
      </h2>
      {note && <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{note}</p>}
      <ul className="mt-2 divide-y divide-line">
        {rows.map(({ charger: c, distance }) => {
          const kw = maxPower(c);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => onSelect(c.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-sunken/60">
                <span
                  aria-hidden
                  className={`size-3 shrink-0 rounded-full border-[3px] bg-white ${c.fault ? 'border-danger' : kw >= 50 ? 'border-ink' : 'border-context'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate font-mono text-[0.8125rem] text-muted">
                    {kw ? `${kw} kW` : 'Power unknown'}
                    {kw >= 50 ? ' · DC' : ' · AC'}
                    {c.fault && ' · fault reported'}
                  </span>
                </span>
                {distance !== null && <span className="shrink-0 font-mono text-[0.8125rem] text-muted">{formatDistance(distance)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {more && <p className="mt-3 text-sm text-muted">Showing the nearest 50. Zoom in to see the rest.</p>}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="-ml-2 mb-3 flex min-h-11 w-fit items-center gap-1.5 rounded-full px-3 font-semibold text-muted hover:bg-sunken hover:text-ink">
      <ArrowLeft className="size-4" /> All chargers
    </button>
  );
}

export function ChargerDetail({
  charger: c,
  distance,
  onBack,
  onBook,
}: {
  charger: Charger;
  distance: number | null;
  onBack: () => void;
  onBook: () => void;
}) {
  const kw = maxPower(c);
  return (
    <div>
      <BackButton onBack={onBack} />
      <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">{c.network || 'Public charger'}</p>
      <h2 className="mt-2 font-display text-3xl leading-[0.95] tracking-[0.012em]">{c.name}</h2>
      <p className="mt-1 text-muted">
        {c.address}
        {distance !== null && ` · ${formatDistance(distance)} away`}
      </p>
      {c.fault && (
        <p className="mt-4 flex gap-2 rounded-xl bg-danger-tint px-4 py-3 text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Drivers have reported a fault here.
        </p>
      )}
      <ul className="mt-5 grid gap-2">
        {c.points.map((p, i) => (
          <li key={i} className="flex items-center justify-between rounded-lg bg-sunken px-4 py-3">
            <span className="font-medium">
              {p.count}× {p.type}
            </span>
            <span className="font-mono text-muted">{p.power} kW</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-muted">
        This charger has no Baywatch guard, so it can’t be reserved: it may be taken when you arrive.
        {kw >= 50 ? '' : ' It charges with AC, which is slower.'}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href={directionsUrl(c)} target="_blank" rel="noopener" className={buttonClass('primary', 'lg')}>
          <Navigation className="size-5" /> Navigate by car
        </a>
        <Button variant="secondary" size="lg" onClick={onBook}>
          <Zap className="size-5" /> Book now
        </Button>
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener" className={buttonClass('secondary', 'lg')}>
            GoingElectric <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    </div>
  );
}

// One Baywatch bay: its status and LED, whether a real barrier stands behind it, Book now and Navigate by car
export function RealBayDetail({ bay: b, mine, distance, onBack, onBook }: { bay: Bay; mine: boolean; distance: number | null; onBack: () => void; onBook: () => void }) {
  const offline = b.status === 'offline';
  const s = BAY_STATUS[b.status];
  return (
    <div>
      <BackButton onBack={onBack} />
      <span className={`${chipClass} ${s.tone}`}>
        {!offline && <Led led={b.led} />}
        {s.label} · {hardwareNote(b)}
      </span>
      <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[0.012em]">{b.name}</h2>
      <p className="mt-1 text-muted">
        {b.address} · {b.powerKw} kW
        {distance !== null && ` · ${formatDistance(distance)} away`}
      </p>
      {offline && (
        <p role="status" className="mt-4 flex gap-3 rounded-2xl bg-warn-tint p-4 font-semibold text-ink">
          <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          {OFFLINE_TEXT}
        </p>
      )}
      {b.status === 'occupied' && !mine && (
        <p role="status" className="mt-4 flex gap-3 rounded-2xl bg-warn-tint p-4 text-ink">
          <CarFront aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <span>
            <span className="font-semibold">A car is in the bay right now,</span> so it can’t be booked for now. Try another Baywatch bay.
          </span>
        </p>
      )}
      {mine ? (
        <Link href="/booking" className={buttonClass('primary', 'lg', 'mt-5')}>
          Open your booking
        </Link>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button size="lg" disabled={offline} onClick={onBook}>
            Book now · from {formatEuro(b.priceFromCents)}
          </Button>
          <a href={directionsUrl(b)} target="_blank" rel="noopener" className={buttonClass('secondary', 'lg')}>
            <Navigation aria-hidden className="size-5" /> Navigate by car
          </a>
        </div>
      )}
      <p className="mt-5 text-sm text-muted">
        {b.guard === 'hardware' ? 'Booking it raises the real barrier at the bay.' : 'No hardware is assigned to this bay yet, so its guard is simulated.'}
      </p>
    </div>
  );
}

export function BayDetail({ state, distance, onBack, onReserve }: { state: AppState; distance: number | null; onBack: () => void; onReserve: () => void }) {
  const { refresh } = useAppState();
  const now = useNow();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const availability = bayAvailability(state);
  const offline = bayOffline(state);
  const r = state.reservation;

  async function waitlist(join: boolean) {
    setBusy(true);
    setError('');
    try {
      await api(join ? 'POST' : 'DELETE', '/api/waitlist');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const notify = state.waiting ? (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <BellRing className="size-5 text-accent" /> We’ll hold it for you when it’s free
      </p>
      <Button variant="ghost" size="sm" loading={busy} onClick={() => waitlist(false)}>
        Stop waiting
      </Button>
    </div>
  ) : (
    <Button variant="secondary" size="lg" className="mt-5" loading={busy} onClick={() => waitlist(true)}>
      <BellRing className="size-5" /> Notify me when it’s free
    </Button>
  );

  return (
    <div>
      <BackButton onBack={onBack} />
      <span className={`${chipClass} ${offline ? 'bg-warn-tint text-warn' : AVAILABILITY[availability].tone}`}>
        {offline ? 'Offline' : AVAILABILITY[availability].label}
      </span>
      <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[0.012em]">{state.bay.name}</h2>
      <p className="mt-1 text-muted">
        {state.bay.address} · {state.bay.powerKw} kW
        {distance !== null && ` · ${formatDistance(distance)} away`}
      </p>

      {availability === 'mine' && (
        <div className="mt-5">
          <p>You have this bay booked.</p>
          <Link href="/booking" className={buttonClass('primary', 'lg', 'mt-4')}>
            Open your booking
          </Link>
        </div>
      )}

      {availability === 'free' && (
        <div className="mt-5">
          {state.priority?.mine && (
            <p role="status" className="mb-4 flex gap-3 rounded-2xl bg-brand-tint p-4 font-semibold text-brand-strong">
              <Clock className="mt-0.5 size-5 shrink-0" />
              The bay is free. It’s held for you to book for {formatCountdown(state.priority.until - now)}.
            </p>
          )}
          {offline && (
            <p role="status" className="mb-4 flex gap-3 rounded-2xl bg-warn-tint p-4 font-semibold text-ink">
              <WifiOff className="mt-0.5 size-5 shrink-0 text-warn" />
              {OFFLINE_TEXT}
            </p>
          )}
          <Button size="lg" className="w-full sm:w-auto" disabled={offline} onClick={onReserve}>
            Book this charger · {formatEuro(state.quote.cents)}
          </Button>
          <p className="mt-3 text-sm text-muted">
            {state.quote.demand} demand right now. Arrive within {state.holdMinutes} min, charge up to {state.session.maxMinutes / 60} h. Free to
            cancel in the first {FREE_CANCEL_MIN} min.
          </p>
        </div>
      )}

      {(availability === 'reserved' || availability === 'in_use') && (
        <div className="mt-5">
          <p>
            {availability === 'reserved' && r
              ? `Reserved by another driver: free again by ${formatTime(r.end + OVERSTAY_GRACE_MS)} at the latest, or at ${formatTime(r.expiresAt)} if they don’t arrive.`
              : r
                ? `Another driver is charging here until ${formatTime(r.end)}.`
                : 'Another driver is charging here right now.'}
          </p>
          {notify}
        </div>
      )}

      {availability === 'occupied' && (
        <div className="mt-5">
          <p>A car is standing in the bay right now. We’ll know the moment it leaves.</p>
          {notify}
        </div>
      )}

      {availability === 'held' && state.priority && (
        <div className="mt-5">
          <p>It’s free, but held for the next driver on the waiting list for {formatCountdown(state.priority.until - now)}.</p>
          {notify}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      )}

      <ul className="mt-8 grid gap-4 border-t border-line pt-6">
        {[
          { icon: ShieldCheck, text: 'A guard keeps the bay closed for whoever booked it.' },
          { icon: Navigation, text: 'Drive in: the camera reads your plate and lowers the guard.' },
          { icon: Zap, text: `${state.bay.powerKw} kW DC. Plug in and pay for charging as usual.` },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3 text-muted">
            <Icon className="mt-0.5 size-5 shrink-0 text-ink" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
