'use client';

import { ArrowLeft, BellRing, Clock, ExternalLink, Navigation, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { formatCountdown, formatTime, useNow } from '@/components/time';
import { Button, buttonClass } from '@/components/ui/button';
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

const AVAILABILITY = {
  mine: { label: 'Booked by you', tone: 'bg-brand-tint text-brand-strong' },
  free: { label: 'Free · reservable', tone: 'bg-brand-tint text-brand-strong' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn' },
  in_use: { label: 'In use', tone: 'bg-warn-tint text-warn' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn' },
  held: { label: 'Held for a waiting driver', tone: 'bg-warn-tint text-warn' },
};

export function ChargerList({
  state,
  bayDistance,
  fromYou,
  rows,
  more,
  note,
  onSelectBay,
  onSelect,
}: {
  state: AppState;
  bayDistance: number | null;
  fromYou: boolean;
  rows: Row[];
  more: boolean;
  note: string;
  onSelectBay: () => void;
  onSelect: (id: number) => void;
}) {
  const a = AVAILABILITY[bayAvailability(state)];
  return (
    <div>
      <button type="button" onClick={onSelectBay} className="group flex w-full items-center gap-4 rounded-2xl bg-brand-deep p-4 text-left text-white">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-signal text-ink">
          <Zap className="size-5 fill-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{state.bay.name}</span>
          <span className="block text-sm text-on-brand">
            {state.bay.powerKw} kW · {a.label}
            {bayAvailability(state) === 'free' && ` · ${formatEuro(state.quote.cents)}`}
            {bayDistance !== null && ` · ${formatDistance(bayDistance)}`}
          </span>
        </span>
        <span className="text-sm font-semibold text-signal group-hover:underline">View</span>
      </button>

      <h2 className="mt-6 flex items-baseline justify-between gap-3 text-sm font-semibold text-muted">
        <span>Public chargers nearby</span>
        <span className="text-right font-normal">{fromYou ? 'Nearest to you' : 'Nearest to the map centre'}</span>
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
                  <span className="block truncate text-sm text-muted">
                    {kw ? `${kw} kW` : 'Power unknown'}
                    {kw >= 50 ? ' · DC' : ' · AC'}
                    {c.fault && ' · fault reported'}
                  </span>
                </span>
                {distance !== null && <span className="shrink-0 text-sm tabular-nums text-muted">{formatDistance(distance)}</span>}
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
    <button type="button" onClick={onBack} className="-ml-2 mb-3 flex min-h-10 w-fit items-center gap-1.5 rounded-lg px-2 font-semibold text-muted hover:bg-sunken hover:text-ink">
      <ArrowLeft className="size-4" /> All chargers
    </button>
  );
}

export function ChargerDetail({ charger: c, distance, onBack }: { charger: Charger; distance: number | null; onBack: () => void }) {
  const kw = maxPower(c);
  return (
    <div>
      <BackButton onBack={onBack} />
      <p className="text-sm font-semibold text-muted">{c.network || 'Public charger'}</p>
      <h2 className="mt-1 font-display text-2xl leading-tight">{c.name}</h2>
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
          <li key={i} className="flex items-center justify-between rounded-xl bg-sunken px-4 py-3">
            <span className="font-medium">
              {p.count}× {p.type}
            </span>
            <span className="tabular-nums text-muted">{p.power} kW</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-muted">
        This charger has no Ecurious guard, so it can’t be reserved: it may be taken when you arrive.
        {kw >= 50 ? '' : ' It charges with AC, which is slower.'}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a href={directionsUrl(c)} target="_blank" rel="noopener" className={buttonClass('primary', 'lg')}>
          <Navigation className="size-5" /> Navigate
        </a>
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener" className={buttonClass('secondary', 'lg')}>
            GoingElectric <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    </div>
  );
}

export function BayDetail({ state, distance, onBack, onReserve }: { state: AppState; distance: number | null; onBack: () => void; onReserve: () => void }) {
  const { refresh } = useAppState();
  const now = useNow();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const availability = bayAvailability(state);
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
      <p className="flex items-center gap-2 font-semibold text-brand-strong">
        <BellRing className="size-5" /> We’ll hold it for you when it’s free
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
      <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${AVAILABILITY[availability].tone}`}>{AVAILABILITY[availability].label}</span>
      <h2 className="mt-3 font-display text-3xl leading-tight">{state.bay.name}</h2>
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
          <Button size="lg" className="w-full sm:w-auto" onClick={onReserve}>
            Reserve for {formatEuro(state.quote.cents)}
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
            <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
