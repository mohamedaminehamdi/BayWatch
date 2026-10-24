'use client';

import { CircleCheck, FlaskConical, Mail, MailCheck, MailWarning, MailX, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/api';
import { formatCountdown, formatTime, useNow } from '@/components/time';
import { Button, chipClass } from '@/components/ui/button';
import { PlateBadge } from '@/components/ui/plate-badge';
import { CPO_SHARE, formatEuro } from '@/lib/pricing';
import type { OperatorData } from '@/lib/server';
import { WeekChart } from './week-chart';

const EMAIL = {
  sent: { icon: MailCheck, label: 'Email sent', tone: 'text-brand-strong' },
  pending: { icon: Mail, label: 'Sending email…', tone: 'text-muted' },
  skipped: { icon: MailWarning, label: 'Email skipped: no Resend key set', tone: 'text-warn' },
  failed: { icon: MailX, label: 'Email failed: see server log', tone: 'text-danger' },
};

const percent = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const minutes = (ms: number | null) => (ms === null ? '–' : `${Math.max(1, Math.round(ms / 60_000))} min`);

function Tile({ label, value, context }: { label: string; value: string; context: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl leading-none tracking-[0.012em]">{value}</p>
      <p className="mt-1.5 text-sm text-muted">{context}</p>
    </div>
  );
}

function LiveBay({ data, now }: { data: OperatorData; now: number }) {
  const r = data.reservation;
  const [status, detail] = data.blockedSince
    ? ['Car in the bay', `No booking, since ${formatTime(data.blockedSince)} (${formatCountdown(now - data.blockedSince)})`]
    : r?.status === 'reserved'
      ? ['Reserved', `Held until ${formatTime(r.expiresAt)}`]
      : r?.status === 'arrived'
        ? ['Driver checked in', 'Guard down, about to charge']
        : r?.status === 'charging'
          ? ['Charging', 'Booked session in progress']
          : ['Free', 'Open to anyone, and reservable'];
  const guardUp = data.hardware.state === 'blocked';
  return (
    <section aria-label="Live bay" className="rounded-3xl bg-brand-deep p-6 text-on-brand">
      <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-on-brand-muted">
        <span className="relative flex size-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-mint/70" />
          <span className="relative size-2.5 rounded-full bg-mint" />
        </span>
        Live · {data.bay.name}
      </p>
      <p className="mt-3 font-display text-4xl leading-[0.9] tracking-[0.012em]">{status}</p>
      <p className="mt-2 text-on-brand">{detail}</p>
      <p className="mt-5 flex items-center gap-2 border-t border-white/14 pt-4 font-mono text-xs uppercase tracking-[0.08em] text-on-brand-muted">
        <ShieldCheck className="size-4 text-mint" />
        Guard {guardUp ? 'up' : 'down'}
        {data.hardware.mock && ' · mock hardware'}
      </p>
    </section>
  );
}

export function OperatorDashboard() {
  const now = useNow();
  const [data, setData] = useState<OperatorData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<OperatorData>('GET', '/api/operator'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && load();
    const t = setInterval(tick, 3000);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load; state is only set after the fetch resolves
    load();
    return () => clearInterval(t);
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  if (!data) return <div className="mx-auto mt-10 h-[32rem] w-full max-w-7xl animate-pulse rounded-3xl bg-sunken px-5" />;

  const open = data.alerts.filter((a) => a.status === 'open');
  const resolved = data.alerts.filter((a) => a.status === 'resolved' && !a.simulated).slice(0, 3);
  const k = data.stats.kpis;
  const checkIns = k.cameraCheckIns + k.fallbackCheckIns;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Bay Guard</p>
          <h1 className="mt-1 font-display text-4xl leading-[0.95] tracking-[0.012em]">Operator dashboard</h1>
          <p className="mt-1 text-muted">
            {data.bay.name} · {data.bay.address} · last 7 days
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data.stats.simulated && (
            // demo-only data is violet, like every other backstage control
            <span className={`${chipClass} bg-accent-tint py-1.5 text-accent`}>
              <FlaskConical className="size-4" /> Includes simulated data
            </span>
          )}
          {data.simulator && (
            <Button variant="secondary" loading={busy === 'simulate'} onClick={() => run('simulate', () => api('POST', '/api/operator/simulate'))}>
              <FlaskConical className="size-4" /> Simulate a week
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-2xl bg-danger-tint p-4 text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="alerts" className="min-w-0">
            <h2 id="alerts" className="flex items-center gap-3 font-display text-3xl leading-none tracking-[0.012em]">
              Blocked-bay alerts
              {open.length > 0 && <span className={`${chipClass} bg-warn text-white`}>{open.length} open</span>}
            </h2>
            <div aria-live="polite" className="mt-3 grid gap-3">
              {open.map((a) => {
                const mail = EMAIL[a.emailStatus];
                return (
                  <article key={a.id} className="grid gap-4 rounded-3xl bg-warn-tint p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-warn">
                        <TriangleAlert className="size-5" /> A car without a booking is in a reserved bay
                      </p>
                      <p className="mt-2 text-lg">
                        Since {formatTime(a.since)} · <span className="font-mono font-semibold">{formatCountdown(now - a.since)}</span> and counting.
                        The waiting driver’s hold is paused.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        {a.plate && <PlateBadge plate={a.plate} size="sm" />}
                        <span className={`flex items-center gap-1.5 text-sm font-medium ${mail.tone}`}>
                          <mail.icon className="size-4" /> {mail.label}
                        </span>
                      </div>
                    </div>
                    <div>
                      <Button size="lg" loading={busy === a.id} onClick={() => run(a.id, () => api('POST', `/api/operator/alerts/${a.id}/resolve`))}>
                        <CircleCheck className="size-5" /> Bay is clear
                      </Button>
                      <p className="mt-2 max-w-[24ch] text-sm text-muted">Resumes the driver’s hold and deletes the plate.</p>
                    </div>
                  </article>
                );
              })}
              {open.length === 0 && (
                <div className="flex gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line">
                  <CircleCheck className="mt-0.5 size-6 shrink-0 text-brand" />
                  <div>
                    <p className="font-semibold">No open alerts</p>
                    <p className="mt-1 text-muted">
                      When a car without a booking stands in a reserved bay, it shows up here and operators get an email.
                    </p>
                  </div>
                </div>
              )}
              {resolved.length > 0 && (
                <ul className="grid gap-1.5 text-sm text-muted">
                  {resolved.map((a) => (
                    <li key={a.id}>
                      Resolved at {formatTime(a.resolvedAt ?? a.since)} by {a.resolvedBy === 'camera' ? 'the camera (car left)' : 'an operator'}, after{' '}
                      {minutes((a.resolvedAt ?? a.since) - a.since)}. Plate deleted.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* on phones the live bay comes right after the alerts; on desktop it heads the side column */}
          <div className="lg:hidden">
            <LiveBay data={data} now={now} />
          </div>

          <section aria-labelledby="kpis">
            <h2 id="kpis" className="font-display text-3xl leading-none tracking-[0.012em]">
              The last 7 days
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Tile label="Reservations" value={String(k.reservations)} context={`${k.ended} finished`} />
              <Tile label="Completed" value={percent(k.completionRate)} context="of finished bookings" />
              <Tile label="No-shows" value={percent(k.noShowRate)} context="released automatically" />
              <Tile label="Time to arrive" value={minutes(k.avgArriveMs)} context="booking to check-in, on average" />
              <Tile label="Blocked incidents" value={String(k.blockedIncidents)} context={`${k.blockedMinutes} min blocked in total`} />
              <Tile label="Checked in by camera" value={percent(checkIns ? k.cameraCheckIns / checkIns : null)} context={`${k.fallbackCheckIns} at the bay without it`} />
              <Tile label="Misreads matched" value={String(k.fuzzyMatches)} context="plates read wrongly, still let in" />
              <Tile label="Your revenue share" value={formatEuro(k.cpoShareCents)} context={`${Math.round(CPO_SHARE * 100)}% of ${formatEuro(k.revenueCents)} in fees`} />
            </div>
          </section>

          <section aria-labelledby="per-day" className="min-w-0 rounded-2xl bg-surface p-5 ring-1 ring-line sm:p-6">
            <h2 id="per-day" className="font-display text-3xl leading-none tracking-[0.012em]">
              Reservations per day
            </h2>
            <p className="mb-4 text-sm text-muted">Hover or focus a day for the breakdown.</p>
            <WeekChart days={data.stats.days} />
          </section>
        </div>

        <div className="grid gap-6">
          <div className="hidden lg:block">
            <LiveBay data={data} now={now} />
          </div>
          <section aria-labelledby="log" className="rounded-2xl bg-surface p-5 ring-1 ring-line">
            <h2 id="log" className="font-display text-2xl leading-none tracking-[0.012em]">
              Event log
            </h2>
            <ol className="mt-3 grid max-h-96 gap-2 overflow-y-auto text-sm">
              {data.log.map((l, i) => (
                <li key={`${l.at}-${i}`} className="flex gap-3">
                  <span className="shrink-0 font-mono text-muted">{formatTime(l.at)}</span>
                  <span>
                    <span className="font-mono text-xs font-semibold uppercase tracking-[0.08em]">{l.type.replace(/_/g, ' ')}</span>
                    {l.detail && <span className="text-muted"> · {l.detail}</span>}
                  </span>
                </li>
              ))}
              {!data.log.length && <li className="text-muted">Nothing has happened at the bay yet.</li>}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
