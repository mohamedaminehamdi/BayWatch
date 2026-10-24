'use client';

import { ChevronDown, Gift, Ticket, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { Receipt } from '@/components/booking/receipt';
import { formatDay, formatTime } from '@/components/time';
import { buttonClass, chipClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { BookingsResponse, ReservationView } from '@/lib/booking-types';
import { formatEuro } from '@/lib/pricing';

const STATUS: Record<string, { label: string; tone: string }> = {
  upcoming: { label: 'Booked', tone: 'bg-brand-tint text-brand-strong' },
  live: { label: 'Live', tone: 'bg-signal text-ink' },
  completed: { label: 'Completed', tone: 'bg-brand-tint text-brand-strong' },
  cancelled: { label: 'Cancelled', tone: 'bg-sunken text-muted' },
  no_show: { label: 'No-show', tone: 'bg-warn-tint text-warn' },
};
const ACTIVE: Record<string, string> = { arrived: 'Checked in', charging: 'Charging', walkup: 'Walk-up' };

const when = (r: ReservationView) => `${formatDay(r.start)} · ${formatTime(r.start)}–${formatTime(r.end)}`;

export function Bookings() {
  const { state } = useAppState();
  const [data, setData] = useState<BookingsResponse | null>(null);
  const [error, setError] = useState('');
  // reload at once when the shell sees the next or active booking change, so a just-finished one shows up
  const key = `${state?.viewer?.active?.id ?? ''}:${state?.viewer?.active?.status ?? ''}:${state?.viewer?.next?.id ?? ''}:${state?.viewer?.next?.status ?? ''}`;

  // and every 4 s while the tab is visible: bookings made elsewhere (by voice, say) show up within 5 s
  useEffect(() => {
    const load = () =>
      api<BookingsResponse>('GET', '/api/bookings?v=2').then(
        (d) => {
          setData(d);
          setError('');
        },
        (e) => setError((e as Error).message),
      );
    const tick = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const t = setInterval(tick, 4000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [key]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <h1 className="font-display text-4xl leading-[0.95] tracking-[0.012em]">Bookings</h1>

      {data && (data.creditCents > 0 || data.firstFree) && (
        <section aria-label="Your credit" className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-brand-tint p-5">
          {data.creditCents > 0 && (
            <p className="flex items-center gap-3">
              <Wallet aria-hidden className="size-5 shrink-0" />
              <span>
                <span className="block font-mono text-xs uppercase tracking-[0.1em] text-muted">Credit</span>
                <span className="font-display text-3xl leading-none tracking-[0.012em]">{formatEuro(data.creditCents)}</span>
              </span>
            </p>
          )}
          <p className="flex-1 text-sm">
            {data.firstFree && (
              <span className="flex items-center gap-2 font-semibold">
                <Gift aria-hidden className="size-4 shrink-0" /> Your first reservation is free.
              </span>
            )}
            {data.creditCents > 0 && <span className="block text-muted">Used automatically on your next booking.</span>}
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-2xl bg-danger-tint p-4 text-danger">
          {error}
        </p>
      )}

      {data?.active && (
        <Link href={`/booking/${encodeURIComponent(data.active.id)}`} className="mt-6 flex items-center gap-4 rounded-3xl bg-brand-deep p-5 text-on-brand hover:bg-brand-strong">
          <span className="relative flex size-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-mint/70" />
            <span className="relative size-3 rounded-full bg-mint" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">
              {ACTIVE[data.active.status] ?? 'Now'} · until {formatTime(data.active.end)}
            </span>
            <span className="text-sm text-on-brand-muted">{data.active.bayName}</span>
          </span>
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-signal">Open →</span>
        </Link>
      )}

      <h2 className="mt-10 font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Upcoming</h2>
      <div className="mt-3 grid gap-3">
        {data === null && !error && <div className="h-24 animate-pulse rounded-2xl bg-sunken" />}
        {data?.upcoming.length === 0 && <p className="rounded-2xl bg-sunken px-4 py-3 text-sm text-muted">Nothing booked. You can book up to 60 days ahead.</p>}
        {data?.upcoming.map((r) => (
          <Link
            key={r.id}
            href={`/booking/${encodeURIComponent(r.id)}`}
            className="flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line hover:ring-line-strong sm:gap-4 sm:p-5"
          >
            <span className={`shrink-0 ${chipClass} ${r.blockedSince ? 'bg-warn-tint text-warn' : STATUS[r.status]?.tone}`}>{r.blockedSince ? 'Bay occupied' : STATUS[r.status]?.label}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{r.bayName}</span>
              <span className="block truncate font-mono text-[0.8125rem] text-muted">{when(r)}</span>
            </span>
            <span className="font-mono font-semibold">{formatEuro(r.feeCents)}</span>
          </Link>
        ))}
      </div>

      <h2 className="mt-10 font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Past</h2>
      <div className="mt-3 grid gap-3">
        {data?.past.length === 0 && (
          <EmptyState
            icon={Ticket}
            title="No past bookings"
            action={
              <Link href="/explore" className={buttonClass('primary', 'lg')}>
                Find a charger
              </Link>
            }
          >
            Finished, cancelled and missed bookings show up here, each with its receipt.
          </EmptyState>
        )}
        {data?.past.map((b) => (
          <details key={b.id} className="group min-w-0 rounded-2xl bg-surface ring-1 ring-line open:ring-line-strong">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-4 sm:gap-4 sm:p-5 [&::-webkit-details-marker]:hidden">
              <span className={`shrink-0 ${chipClass} ${STATUS[b.status]?.tone ?? 'bg-sunken text-muted'}`}>{STATUS[b.status]?.label ?? b.status}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{b.bayName}</span>
                <span className="block truncate font-mono text-[0.8125rem] text-muted">{when(b)}</span>
              </span>
              <span className="font-mono font-semibold">{formatEuro(b.totalCents)}</span>
              <ChevronDown aria-hidden className="size-5 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-line px-5 pb-5 pt-4">
              <Receipt charges={b.charges} totalCents={b.totalCents} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
