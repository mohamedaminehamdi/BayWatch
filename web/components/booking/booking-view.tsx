'use client';

import { BellRing, CarFront, CircleCheck, Clock, MapPin, Navigation, PlugZap, ScanLine, Timer, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { formatCountdown, formatTime, useNow } from '@/components/time';
import { Button, buttonClass } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, inputClass } from '@/components/ui/field';
import { PlateBadge } from '@/components/ui/plate-badge';
import { directionsUrl, distanceM, formatDistance } from '@/lib/geo';
import { formatLength } from '@/components/explore/reserve-dialog';
import type { Charger } from '@/lib/goingelectric';
import { cancellationFee, OVERSTAY_CAP_CENTS, OVERSTAY_GRACE_MS, TYPES } from '@/lib/booking-rules';
import { EXTENSION_MIN, formatEuro, FREE_CANCEL_MS, PRICES } from '@/lib/pricing';
import type { ReservationView } from '@/lib/reservation';
import type { AppState } from '@/lib/server';
import { Receipt } from './receipt';
import { StatusStepper } from './status-stepper';

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
// "1 h 5 min" rather than "1:05:00", which reads like a time of day next to 24-hour clock times
const MIN = 60_000;
const duration = (ms: number) => formatLength(Math.max(1, Math.round(ms / MIN)));

function Banner({ tone, icon: Icon, children }: { tone: 'info' | 'warn'; icon: typeof Clock; children: ReactNode }) {
  return (
    <div role="status" className={`flex gap-3 rounded-2xl p-4 ${tone === 'warn' ? 'bg-warn-tint text-warn' : 'bg-brand-tint text-brand-strong'}`}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="font-medium">{children}</div>
    </div>
  );
}

export function BookingView() {
  const { state, refresh } = useAppState();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<null | 'cancel' | 'other-car'>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try {
      await fn();
      await refresh();
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  if (!state) return <div className="mx-auto mt-10 h-96 w-full max-w-2xl animate-pulse rounded-3xl bg-sunken" />;
  const r = state.reservation?.mine ? state.reservation : null;
  if (!r)
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <EmptyState
          icon={MapPin}
          title="No booking right now"
          action={
            <Link href="/explore?bay" className={buttonClass('primary', 'lg')}>
              Find the bay
            </Link>
          }
        >
          Reserve the Ecurious bay and it’s held free for you while you drive there.
        </EmptyState>
      </div>
    );

  const step = (key: string, action: string, body?: unknown) => act(key, () => api('POST', `/api/reservation/${action}`, body));

  function checkInHere() {
    if (!navigator.geolocation) return setError('Your browser can’t share its location.');
    setBusy('checkin');
    navigator.geolocation.getCurrentPosition(
      (p) => step('checkin', 'checkin', { lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        setBusy(null);
        setError('Allow location access so we can confirm you’re at the bay.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const ended = !['reserved', 'arrived', 'charging'].includes(r.status);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Your booking</p>
          <h1 className="font-display text-3xl leading-tight">{state.bay.name}</h1>
          <p className="text-muted">
            {state.bay.address} · {state.bay.powerKw} kW
          </p>
        </div>
        {!ended && (
          <a href={directionsUrl(state.bay)} target="_blank" rel="noopener" className={buttonClass('secondary', 'md')}>
            <Navigation className="size-4" /> Navigate
          </a>
        )}
      </div>

      {(r.status !== 'cancelled' && r.status !== 'no_show') && (
        <div className="mt-6">
          <StatusStepper status={r.status} />
        </div>
      )}

      <div aria-live="polite" className="mt-6 grid gap-4">
        {r.status === 'reserved' && !r.blockedSince && (
          <Reserved r={r} state={state} now={now} busy={busy} onStep={step} onCheckIn={checkInHere} onDialog={setDialog} />
        )}
        {r.status === 'reserved' && r.blockedSince && <Blocked r={r} state={state} busy={busy} onCancel={() => step('cancel', 'cancel')} />}
        {r.status === 'arrived' && <Arrived r={r} state={state} now={now} busy={busy} onCharge={() => step('charge', 'charge')} />}
        {r.status === 'charging' && <Charging r={r} state={state} now={now} busy={busy} onFinish={() => step('finish', 'finish')} />}
        {ended && <Done r={r} />}

        {error && (
          <p role="alert" className="flex gap-2 rounded-2xl bg-danger-tint p-4 text-danger">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" /> {error}
          </p>
        )}
      </div>

      <CancelDialog
        open={dialog === 'cancel'}
        r={r}
        now={now}
        busy={busy === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={() => step('cancel', 'cancel')}
      />
      <OtherCarDialog
        open={dialog === 'other-car'}
        busy={busy === 'other-plate'}
        onClose={() => setDialog(null)}
        onSubmit={(plate) => step('other-plate', 'other-plate', { plate, consent: true })}
      />
    </div>
  );
}

// The session's times and fee, shown on every live booking screen
function SessionFacts({ r, now, cancelling }: { r: ReservationView; now: number; cancelling?: boolean }) {
  const t = TYPES[r.type ?? 'fast'];
  const freeLeft = (r.createdAt ?? 0) + FREE_CANCEL_MS - now;
  const cancelNow = r.blockedSince ? 0 : cancellationFee(r.feeCents ?? 0, { bookedAt: r.createdAt ?? 0, start: r.start ?? 0, cancelledAt: now });
  const rows: [string, string][] = [
    ['Session', `${formatTime(r.start ?? 0)}–${formatTime(r.end)} · ${t.label}`],
    ['Leave by', `${formatTime(r.end + OVERSTAY_GRACE_MS)}, then ${formatEuro(t.overstayCentsPerMin)}/min (max ${formatEuro(OVERSTAY_CAP_CENTS)})`],
    ['Fee', `${formatEuro(r.feeCents ?? 0)} · ${(r.demand ?? 'normal').toLowerCase()} demand${r.prepaid ? ' · prepaid' : ''}`],
  ];
  if (cancelling) rows.push(['Cancelling now', cancelNow === 0 ? (r.blockedSince ? 'free, the bay is blocked' : `free for another ${formatCountdown(freeLeft)}`) : `costs ${formatEuro(cancelNow)}`]);
  return (
    <dl className="grid gap-x-6 gap-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const REMINDER_TEXT = {
  ends_in_1h: (r: ReservationView) => `Your session ends at ${formatTime(r.end)}. Please leave the bay by ${formatTime(r.end + OVERSTAY_GRACE_MS)}.`,
  ends_in_15m: (r: ReservationView) =>
    `15 minutes left. From ${formatTime(r.end + OVERSTAY_GRACE_MS)}, idle time costs ${formatEuro(TYPES[r.type ?? 'fast'].overstayCentsPerMin)} a minute.`,
};

// End-of-session reminders sent by the server: an in-app banner, plus a browser notification if allowed
function SessionReminder({ r, bayName }: { r: ReservationView; bayName: string }) {
  const shown = useRef(new Set<string>());
  const last = r.sentReminders?.filter((s) => s.key in REMINDER_TEXT).at(-1);
  useEffect(() => {
    if (!last || shown.current.has(last.key)) return;
    shown.current.add(last.key);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(bayName, { body: REMINDER_TEXT[last.key as keyof typeof REMINDER_TEXT](r) });
    }
  }, [last, bayName, r]);
  if (!last) return null;
  return (
    <Banner tone="warn" icon={BellRing}>
      {REMINDER_TEXT[last.key as keyof typeof REMINDER_TEXT](r)}
    </Banner>
  );
}

function NotifyMe() {
  // this screen only renders in the browser (after the booking loads), so window is safe here
  const [ask, setAsk] = useState(() => 'Notification' in window && Notification.permission === 'default');
  if (!ask) return null;
  return (
    <button
      type="button"
      onClick={() => Notification.requestPermission().then(() => setAsk(false))}
      className="justify-self-start text-sm font-semibold text-brand-strong underline underline-offset-2"
    >
      Get a notification before your session ends
    </button>
  );
}

function Reserved({
  r,
  state,
  now,
  busy,
  onStep,
  onCheckIn,
  onDialog,
}: {
  r: ReservationView;
  state: AppState;
  now: number;
  busy: string | null;
  onStep: (key: string, action: string) => void;
  onCheckIn: () => void;
  onDialog: (d: 'cancel' | 'other-car') => void;
}) {
  return (
    <>
      {r.unreadableAt && (
        <Banner tone="info" icon={ScanLine}>
          The camera saw a car but couldn’t read its plate. If that’s you, tap “I’m at the bay”.
        </Banner>
      )}

      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-sm font-semibold text-brand-strong">
          <span className="size-2 rounded-full bg-brand" /> Held for you
        </span>
        <p className="mt-3 font-display text-7xl leading-none tabular-nums tracking-tight sm:text-8xl">{formatCountdown(r.expiresAt - now)}</p>
        <p className="mt-2 text-lg text-muted">
          left to arrive · <span className="font-semibold text-ink">arrive by {formatTime(r.expiresAt)}</span>
          {r.extendedAt ? ' (extended)' : ''}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <CarFront className="size-5 text-muted" />
          <span className="font-semibold">{r.vehicleLabel}</span>
          {r.plateHint && <PlateBadge plate={r.plateHint} size="sm" />}
          {r.extraPlateHint && (
            <span className="flex items-center gap-2 text-sm text-muted">
              and today <PlateBadge plate={r.extraPlateHint} size="sm" />
            </span>
          )}
        </div>
        <p className="mb-5 mt-3 text-sm text-muted">The guard is up. When you drive in, the camera reads your plate and lowers it.</p>
        <SessionFacts r={r} now={now} cancelling />
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <a href={directionsUrl(state.bay)} target="_blank" rel="noopener" className={buttonClass('primary', 'lg', 'sm:col-span-2')}>
          <Navigation className="size-5" /> Navigate to the bay
        </a>
        <Button variant="secondary" size="lg" loading={busy === 'checkin'} onClick={onCheckIn}>
          <MapPin className="size-5" /> I’m at the bay
        </Button>
        <Button variant="secondary" size="lg" loading={busy === 'extend'} disabled={!!r.extendedAt} onClick={() => onStep('extend', 'extend')}>
          <Timer className="size-5" /> {r.extendedAt ? `Extended by ${EXTENSION_MIN} min` : `+${EXTENSION_MIN} min · ${formatEuro(PRICES.extension)}`}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => onDialog('other-car')}>
          <CarFront className="size-5" /> Different car today
        </Button>
        <Button variant="ghost" size="lg" onClick={() => onDialog('cancel')}>
          <X className="size-5" /> Cancel booking
        </Button>
      </div>
      <NotifyMe />
    </>
  );
}

function Blocked({ r, state, busy, onCancel }: { r: ReservationView; state: AppState; busy: string | null; onCancel: () => void }) {
  const [choice, setChoice] = useState<null | 'wait' | 'other'>(null);
  const [nearby, setNearby] = useState<(Charger & { distance: number })[] | null>(null);
  const paused = r.expiresAt - (r.blockedSince ?? r.expiresAt);

  async function findOther() {
    setChoice('other');
    const { lat, lng } = state.bay;
    const found = await api<{ chargers: Charger[] }>('GET', `/api/chargers?sw_lat=${lat - 0.02}&sw_lng=${lng - 0.03}&ne_lat=${lat + 0.02}&ne_lng=${lng + 0.03}`).catch(
      () => ({ chargers: [] }),
    );
    setNearby(
      found.chargers
        .filter((c) => !c.fault)
        .map((c) => ({ ...c, distance: distanceM(state.bay, c) }))
        .filter((c) => c.distance > 15)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4),
    );
  }

  return (
    <>
      <section className="rounded-3xl bg-warn-tint p-6 text-ink sm:p-8">
        <TriangleAlert className="size-8 text-warn" />
        <h2 className="mt-3 font-display text-3xl">Another car is in your bay</h2>
        <p className="mt-2 text-lg">
          Your hold is paused with <span className="font-semibold tabular-nums">{formatCountdown(paused)}</span> left, so you lose no time.
          We’ve alerted the operator.
        </p>
        <p className="mt-1 text-muted">Since {formatTime(r.blockedSince ?? 0)}. If you cancel now, it’s free.</p>
      </section>

      {choice !== 'other' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant={choice === 'wait' ? 'secondary' : 'primary'} size="lg" onClick={() => setChoice('wait')}>
            <Clock className="size-5" /> Keep waiting
          </Button>
          <Button variant="secondary" size="lg" onClick={findOther}>
            <Navigation className="size-5" /> Find another charger
          </Button>
        </div>
      )}
      {choice === 'wait' && (
        <p className="text-muted">We’ll keep the bay for you. The timer starts again the moment the other car leaves.</p>
      )}

      {choice === 'other' && (
        <section className="rounded-3xl bg-surface p-6 ring-1 ring-line">
          <h3 className="font-display text-xl">Nearest public chargers</h3>
          <p className="text-sm text-muted">Not reservable: first come, first served.</p>
          {nearby === null ? (
            <div className="mt-4 h-40 animate-pulse rounded-2xl bg-sunken" />
          ) : nearby.length ? (
            <ul className="mt-3 divide-y divide-line">
              {nearby.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="text-sm text-muted">
                      {Math.max(0, ...c.points.map((p) => p.power))} kW · {formatDistance(c.distance)}
                    </span>
                  </span>
                  <a href={directionsUrl(c)} target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')}>
                    <Navigation className="size-4" /> Go
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-muted">No other chargers found nearby.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
            <Button variant="danger" loading={busy === 'cancel'} onClick={onCancel}>
              Cancel for free
            </Button>
            <Button variant="ghost" onClick={() => setChoice('wait')}>
              Keep waiting instead
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

const CHECK_IN = {
  exact: 'The camera recognised your plate.',
  fuzzy: 'The camera recognised your plate, even though it misread a character.',
  fallback: 'You checked in at the bay yourself.',
};

function Arrived({ r, state, now, busy, onCharge }: { r: ReservationView; state: AppState; now: number; busy: string | null; onCharge: () => void }) {
  const how = r.checkInMethod === 'fallback' ? CHECK_IN.fallback : r.matchedBy === 'fuzzy' ? CHECK_IN.fuzzy : CHECK_IN.exact;
  return (
    <>
      <SessionReminder r={r} bayName={state.bay.name} />
      <section className="rounded-3xl bg-brand-deep p-6 text-white sm:p-8">
        <CircleCheck className="size-9 text-mint" />
        <h2 className="mt-3 font-display text-4xl">You’re checked in</h2>
        <p className="mt-2 text-lg text-on-brand">
          {how} The guard is down: park and plug in.
        </p>
        {r.arrivedAt && <p className="mt-1 text-on-brand-muted">Arrived at {formatTime(r.arrivedAt)}</p>}
      </section>
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line">
        <SessionFacts r={r} now={now} />
      </section>
      <Button size="lg" loading={busy === 'charge'} onClick={onCharge}>
        <PlugZap className="size-5" /> Start charging
      </Button>
      <p className="text-sm text-muted">Prototype: the charger isn’t connected yet, so starting is a tap here.</p>
      <NotifyMe />
    </>
  );
}

function Charging({ r, state, now, busy, onFinish }: { r: ReservationView; state: AppState; now: number; busy: string | null; onFinish: () => void }) {
  const left = r.end - now;
  return (
    <>
      <SessionReminder r={r} bayName={state.bay.name} />
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-sm font-semibold text-brand-strong">
          <PlugZap className="size-4" /> Charging
        </span>
        <p className="mt-3 font-display text-7xl leading-none tabular-nums tracking-tight">{elapsed(now - (r.chargingAt ?? now))}</p>
        <p className="mb-5 mt-2 text-lg text-muted">
          since {formatTime(r.chargingAt ?? 0)} ·{' '}
          {left > 0 ? (
            `session ends at ${formatTime(r.end)}, in ${formatLength(Math.ceil(left / MIN))}`
          ) : (
            <span className="font-semibold text-warn">your session has ended</span>
          )}
          . When you drive off, the camera ends it.
        </p>
        <SessionFacts r={r} now={now} />
      </section>
      <Button size="lg" loading={busy === 'finish'} onClick={onFinish}>
        Finish and leave
      </Button>
      <NotifyMe />
    </>
  );
}

function doneText(r: ReservationView) {
  const total = r.totalCents ?? 0;
  if (r.status === 'completed') {
    const over = r.charges?.find((c) => c.kind === 'overstay');
    return {
      title: 'Session complete',
      text: over ? `Thanks for charging. You stayed past the grace, so idle time was added: ${formatEuro(over.cents)}.` : 'Thanks for charging. The bay is free for the next driver.',
    };
  }
  if (r.status === 'cancelled') {
    return {
      title: 'Booking cancelled',
      text: total ? `The guard is down and the bay is free again. Cancelling cost ${formatEuro(total)}; the rest was returned.` : 'The guard is down and the bay is free again. Nothing was charged.',
    };
  }
  return {
    title: 'You didn’t arrive in time',
    text: r.prepaid
      ? `The bay was released for other drivers. You had prepaid, so the ${formatEuro(total)} is kept.`
      : `The bay was released for other drivers. You pay half the fee, ${formatEuro(total)}; the rest was returned.`,
  };
}

function Done({ r }: { r: ReservationView }) {
  const d = doneText(r);
  const rows = [
    ['Reserved', formatTime(r.createdAt ?? 0)],
    r.arrivedAt && ['Checked in', formatTime(r.arrivedAt)],
    r.chargingAt && r.endedAt && ['Charged for', duration(r.endedAt - r.chargingAt)],
    r.blockedMs ? ['Bay blocked for', duration(r.blockedMs)] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <h2 className="font-display text-4xl">{d.title}</h2>
        <p className="mt-2 text-lg text-muted">{d.text}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-5 sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <h3 className="mb-4 font-display text-xl">Receipt</h3>
        <Receipt charges={r.charges ?? []} totalCents={r.totalCents ?? 0} />
      </section>
      <div className="flex flex-wrap gap-3">
        <Link href="/explore" className={buttonClass('primary', 'lg')}>
          Back to the map
        </Link>
        <Link href="/bookings" className={buttonClass('secondary', 'lg')}>
          All bookings
        </Link>
      </div>
    </>
  );
}

function CancelDialog({ open, r, now, busy, onClose, onConfirm }: { open: boolean; r: ReservationView; now: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const fee = r.blockedSince ? 0 : cancellationFee(r.feeCents ?? 0, { bookedAt: r.createdAt ?? 0, start: r.start ?? 0, cancelledAt: now });
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this booking?">
      <p className="text-lg">
        {fee === 0
          ? 'Cancelling now is free: you get everything back.'
          : `Cancelling now costs ${formatEuro(fee)}. The rest of the ${formatEuro(r.totalCents ?? 0)} you paid comes back.`}
      </p>
      <p className="mt-2 text-muted">That’s always less than not turning up. The guard comes down and the bay is free for other drivers.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="danger" size="lg" loading={busy} onClick={onConfirm}>
          Cancel booking
        </Button>
        <Button variant="secondary" size="lg" onClick={onClose}>
          Keep it
        </Button>
      </div>
    </Dialog>
  );
}

function OtherCarDialog({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (plate: string) => void }) {
  const [plate, setPlate] = useState('');
  const [consent, setConsent] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Driving a different car?">
      <form
        className="grid gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit(plate);
        }}
      >
        <p className="text-muted">Add today’s plate and the camera lets that car in too. It’s forgotten when the booking ends.</p>
        <Field label="Today’s license plate">
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            required
            maxLength={14}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="B XY 123"
            className={`${inputClass} font-mono text-lg font-semibold tracking-[0.06em]`}
          />
        </Field>
        <label className="flex cursor-pointer gap-3 rounded-2xl bg-sunken p-4">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
          <span>Use this plate to check me in for this booking only.</span>
        </label>
        <Button type="submit" size="lg" loading={busy} disabled={!plate.trim() || !consent}>
          Add plate
        </Button>
      </form>
    </Dialog>
  );
}
