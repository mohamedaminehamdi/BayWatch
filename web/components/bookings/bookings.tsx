'use client';

import { ChevronDown, Ticket } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { Receipt } from '@/components/booking/receipt';
import { formatDay, formatTime } from '@/components/time';
import { buttonClass, chipClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatEuro } from '@/lib/pricing';
import { ACTIVE, type ReservationView } from '@/lib/reservation';

const STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'bg-brand-tint text-brand-strong' },
  cancelled: { label: 'Cancelled', tone: 'bg-sunken text-muted' },
  no_show: { label: 'No-show', tone: 'bg-warn-tint text-warn' },
};

const LIVE: Record<string, string> = { reserved: 'Held for you', arrived: 'Checked in', charging: 'Charging' };

export function Bookings() {
  const { state } = useAppState();
  const [list, setList] = useState<ReservationView[] | null>(null);
  const r = state?.reservation;
  const live = r?.mine && ACTIVE.has(r.status) ? r : null;

  // reload history whenever the live booking changes, so a just-finished one shows up
  useEffect(() => {
    api<ReservationView[]>('GET', '/api/bookings').then(setList, () => setList([]));
  }, [r?.status]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <h1 className="font-display text-4xl leading-[0.95] tracking-[0.012em]">Bookings</h1>

      {live && (
        <Link href="/booking" className="mt-6 flex items-center gap-4 rounded-3xl bg-brand-deep p-5 text-on-brand hover:bg-brand-strong">
          <span className="relative flex size-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-mint/70" />
            <span className="relative size-3 rounded-full bg-mint" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">
              {LIVE[live.status]}
              {live.status === 'reserved' && !live.blockedSince && ` · until ${formatTime(live.expiresAt)}`}
              {live.blockedSince && ' · bay blocked, hold paused'}
            </span>
            <span className="text-sm text-on-brand-muted">{state?.bay.name}</span>
          </span>
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-signal">Open →</span>
        </Link>
      )}

      <h2 className="mt-10 font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Past bookings</h2>
      <div className="mt-3 grid gap-3">
        {list === null && <div className="h-24 animate-pulse rounded-2xl bg-sunken" />}
        {list?.length === 0 && (
          <EmptyState
            icon={Ticket}
            title="No past bookings"
            action={
              <Link href="/explore?bay" className={buttonClass('primary', 'lg')}>
                Find the bay
              </Link>
            }
          >
            Finished, cancelled and expired bookings show up here, each with its receipt.
          </EmptyState>
        )}
        {list?.map((b) => (
          <details key={b.id} className="group min-w-0 rounded-2xl bg-surface ring-1 ring-line open:ring-line-strong">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:gap-4 sm:p-5 [&::-webkit-details-marker]:hidden">
              <span className={`shrink-0 ${chipClass} ${STATUS[b.status]?.tone}`}>{STATUS[b.status]?.label}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{formatDay(b.createdAt ?? 0)}</span>
                <span className="block truncate text-sm text-muted">
                  {formatTime(b.createdAt ?? 0)} · {b.vehicleLabel}
                </span>
              </span>
              <span className="font-mono font-semibold">{formatEuro(b.totalCents ?? 0)}</span>
              <ChevronDown className="size-5 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-line px-5 pb-5 pt-4">
              <Receipt charges={b.charges ?? []} totalCents={b.totalCents ?? 0} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
