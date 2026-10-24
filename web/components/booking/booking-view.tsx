'use client';

import { BellRing, CarFront, CircleCheck, Clock, Construction, FlaskConical, MapPin, Navigation, PlugZap, ScanLine, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { hardwareNote } from '@/components/explore/panels';
import { formatCountdown, formatTime, useNow } from '@/components/time';
import { Button, buttonClass, chipClass } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, inputClass } from '@/components/ui/field';
import { PlateBadge } from '@/components/ui/plate-badge';
import type { Bay, BayDetail, BookingsResponse, ReminderKey, ReservationView } from '@/lib/booking-types';
import { IDLE_CENTS_PER_MIN, IDLE_GRACE_MS, OVERSTAY_CAP_CENTS } from '@/lib/booking-rules';
import { directionsUrl } from '@/lib/geo';
import { formatEuro } from '@/lib/pricing';
import type { Vehicle } from '@/lib/vehicles';
import { AlternativeList } from './alternatives';
import { barrierNote, BookingFlow } from './booking-flow';
import { CancelSchedule } from './cancel-schedule';
import { Receipt } from './receipt';
import { formatLength } from './slot-picker';
import { StatusStepper } from './status-stepper';

const MIN = 60_000;
const ENDED = new Set(['completed', 'cancelled', 'no_show']);
const duration = (ms: number) => formatLength(Math.max(1, Math.round(ms / MIN)));
const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
const day = (at: number, now: number) =>
  new Date(at).toDateString() === new Date(now).toDateString() ? 'Today' : new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// What cancelling costs right now, as a share of the fee (the step of the schedule we're in)
const cancelPercent = (r: ReservationView, now: number) => [...r.cancelSchedule].reverse().find((s) => s.from <= now)?.percent ?? 0;

const REMINDER: Record<ReminderKey, (r: ReservationView, now: number) => string> = {
  day_before: (r, now) => `Tomorrow at ${formatTime(r.start)}: ${r.bayName}. Cancelling now costs ${cancelPercent(r, now)}% of the fee.`,
  live: (r, now) => `Your booking is live: the bay is held for you from ${formatTime(r.start)}. Cancelling now costs ${cancelPercent(r, now)}%.`,
  five_before: (r, now) => `Starts in 5 minutes. Cancelling now costs ${cancelPercent(r, now)}%.`,
  five_left: (r) => `5 minutes left in your slot. It ends at ${formatTime(r.end)}.`,
  slot_over: (r) => `Your slot is over. You have ${IDLE_GRACE_MS / MIN} free minutes to leave, until ${formatTime(r.end + IDLE_GRACE_MS)}.`,
  idle_fee: () => `Idle fee now: ${formatEuro(IDLE_CENTS_PER_MIN)} a minute, up to ${formatEuro(OVERSTAY_CAP_CENTS)}. Please move the car.`,
};

function Banner({ tone, icon: Icon, children }: { tone: 'info' | 'warn'; icon: typeof Clock; children: ReactNode }) {
  return (
    <div role="status" className={`flex gap-3 rounded-2xl p-4 text-ink ${tone === 'warn' ? 'bg-warn-tint' : 'bg-accent-tint'}`}>
      <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${tone === 'warn' ? 'text-warn' : 'text-accent'}`} />
      <div className="font-medium">{children}</div>
    </div>
  );
}

// /booking: straight to the booking that matters now (active, else the next one)
export function ActiveBookingRedirect() {
  const router = useRouter();
  const [none, setNone] = useState(false);
  useEffect(() => {
    api<BookingsResponse>('GET', '/api/bookings?v=2').then(
      (b) => {
        const r = b.active ?? b.upcoming[0];
        if (r) router.replace(`/booking/${encodeURIComponent(r.id)}`);
        else setNone(true);
      },
      () => setNone(true),
    );
  }, [router]);
  if (!none) return <div className="mx-auto mt-10 h-96 w-full max-w-2xl animate-pulse rounded-3xl bg-sunken" />;
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <EmptyState
        icon={MapPin}
        title="No booking right now"
        action={
          <Link href="/explore" className={buttonClass('primary', 'lg')}>
            Find a charger
          </Link>
        }
      >
        Book any charger and its bay is held free for you while you drive there.
      </EmptyState>
    </div>
  );
}

export function BookingScreen({ id }: { id: string }) {
  const { refresh: refreshShell } = useAppState();
  const now = useNow();
  const [r, setR] = useState<ReservationView | null>(null);
  const [bay, setBay] = useState<BayDetail | null>(null);
  const [missing, setMissing] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<null | 'cancel' | 'other-car'>(null);
  const [bookInstead, setBookInstead] = useState<Bay | null>(null);

  const load = useCallback(async () => {
    try {
      setR(await api<ReservationView>('GET', `/api/reservations/${encodeURIComponent(id)}`));
    } catch (e) {
      setMissing((e as Error).message);
    }
  }, [id]);

  // poll while the booking is still moving; the server changes states on its own (live, no-show, blocked)
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && load();
    const t = setInterval(tick, 3000);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load; state is only set after the fetch resolves
    load();
    return () => clearInterval(t);
  }, [load]);

  const bayId = r?.bayId;
  useEffect(() => {
    if (!bayId) return;
    api<BayDetail>('GET', `/api/bays/${encodeURIComponent(bayId)}`).then(setBay, () => {});
  }, [bayId]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try {
      await fn();
      await Promise.all([load(), refreshShell()]);
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }
  const post = (action: string, body?: unknown) => () => api('POST', `/api/reservations/${encodeURIComponent(id)}/${action}`, body);

  function checkIn() {
    if (!navigator.geolocation) return setError('Your browser can’t share its location.');
    setBusy('checkin');
    navigator.geolocation.getCurrentPosition(
      (p) => act('checkin', post('checkin', { lat: p.coords.latitude, lng: p.coords.longitude })),
      () => {
        setBusy(null);
        setError('Allow location access so we can confirm you’re at the bay.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (missing && !r)
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <EmptyState icon={MapPin} title="Booking not found" action={<Link href="/bookings" className={buttonClass('primary', 'lg')}>All bookings</Link>}>
          {missing}
        </EmptyState>
      </div>
    );
  if (!r || !now) return <div className="mx-auto mt-10 h-96 w-full max-w-2xl animate-pulse rounded-3xl bg-sunken" />;

  const ended = ENDED.has(r.status);
  const canChangeCar = (r.status === 'upcoming' || r.status === 'live') && !r.blockedSince;
  const reminder = r.sentReminders.at(-1);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">{r.status === 'walkup' ? 'Walk-up session' : 'Your booking'}</p>
          <h1 className="mt-1 font-display text-4xl leading-[0.95] tracking-[0.012em]">{r.bayName}</h1>
          <p className="mt-1 font-mono text-sm uppercase tracking-[0.06em] text-muted">
            {day(r.start, now)} · {formatTime(r.start)}–{formatTime(r.end)} · {duration(r.end - r.start)}
          </p>
        </div>
        {!ended && bay && (
          <a href={directionsUrl(bay)} target="_blank" rel="noopener" className={buttonClass('secondary', 'md')}>
            <Navigation aria-hidden className="size-4" /> Navigate by car
          </a>
        )}
      </div>

      {/* bw-1 and bw-2 are real locks: say so, since the booking really moves the barrier */}
      {r.guard === 'hardware' ? (
        !ended && (
          <p className="mt-4 flex gap-2.5">
            <Construction aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <span>
              <span className="font-semibold">This raises the real barrier at the bay.</span>
              {(r.status === 'upcoming' || r.status === 'live') && !r.blockedSince && ` ${barrierNote(r.start, now)}`}
            </span>
          </p>
        )
      ) : (
        <p className={`${chipClass} mt-4 bg-accent-tint text-accent`}>
          <FlaskConical aria-hidden className="size-3.5" />
          {hardwareNote({ guard: r.guard, real: r.real } as Bay)}
        </p>
      )}

      {r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'walkup' && (
        <div className="mt-6">
          <StatusStepper status={r.status} />
        </div>
      )}

      <div aria-live="polite" className="mt-6 grid gap-4">
        {reminder && !ended && (
          <Banner tone={reminder.key === 'idle_fee' || reminder.key === 'slot_over' || reminder.key === 'five_before' ? 'warn' : 'info'} icon={BellRing}>
            {REMINDER[reminder.key](r, now)}
          </Banner>
        )}
        <ReminderNotification r={r} now={now} />

        {r.blockedSince && !ended ? (
          <Blocked r={r} from={bay} busy={busy} onCancel={() => act('cancel', post('cancel'))} onBookInstead={setBookInstead} />
        ) : r.status === 'upcoming' ? (
          <Upcoming r={r} now={now} />
        ) : r.status === 'live' ? (
          <Live r={r} now={now} busy={busy} onCheckIn={checkIn} />
        ) : r.status === 'arrived' ? (
          <Arrived r={r} busy={busy} onCharge={() => act('charge', post('charge'))} />
        ) : r.status === 'charging' || r.status === 'walkup' ? (
          <Session r={r} now={now} busy={busy} onFinish={() => act('finish', post('finish'))} />
        ) : (
          <Done r={r} />
        )}

        {!ended && !r.blockedSince && <Facts r={r} now={now} />}

        {!ended && (canChangeCar || r.cancelNowCents !== null) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {canChangeCar && (
              <Button variant="secondary" size="lg" onClick={() => setDialog('other-car')}>
                <CarFront aria-hidden className="size-5" /> Different car today
              </Button>
            )}
            {r.cancelNowCents !== null && !r.blockedSince && (
              <Button variant="ghost" size="lg" onClick={() => setDialog('cancel')}>
                <X aria-hidden className="size-5" /> Cancel booking
              </Button>
            )}
          </div>
        )}
        {!ended && <NotifyMe />}

        {error && (
          <p role="alert" className="flex gap-2 rounded-2xl bg-danger-tint p-4 text-danger">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" /> {error}
          </p>
        )}
      </div>

      <CancelDialog open={dialog === 'cancel'} r={r} busy={busy === 'cancel'} onClose={() => setDialog(null)} onConfirm={() => act('cancel', post('cancel'))} />
      <OtherCarDialog
        open={dialog === 'other-car'}
        busy={busy === 'plate'}
        onClose={() => setDialog(null)}
        onSubmit={(body) => act('plate', post('plate', body))}
      />
      <BookingFlow bay={bookInstead} onClose={() => setBookInstead(null)} />
    </div>
  );
}

// The latest server reminder as a browser notification too, once, if the driver allowed them
function ReminderNotification({ r, now }: { r: ReservationView; now: number }) {
  const shown = useRef(new Set<string>());
  const last = r.sentReminders.at(-1);
  useEffect(() => {
    if (!last || shown.current.has(last.key) || !('Notification' in window) || Notification.permission !== 'granted') return;
    shown.current.add(last.key);
    new Notification(r.bayName, { body: REMINDER[last.key](r, now) });
  }, [last, r, now]);
  return null;
}

function NotifyMe() {
  // this screen only renders in the browser (after the booking loads), so window is safe here
  const [ask, setAsk] = useState(() => 'Notification' in window && Notification.permission === 'default');
  if (!ask) return null;
  return (
    <button
      type="button"
      onClick={() => Notification.requestPermission().then(() => setAsk(false))}
      className="inline-flex min-h-11 items-center justify-self-start text-sm font-semibold text-accent underline underline-offset-2"
    >
      Get notifications for this booking
    </button>
  );
}

// The session's times and money, on every live booking screen
function Facts({ r, now }: { r: ReservationView; now: number }) {
  const rows: [string, string][] = [
    ['Session', `${formatTime(r.start)}–${formatTime(r.end)} · ${duration(r.end - r.start)}`],
    ...(r.status === 'upcoming' || r.status === 'live' ? ([['Arrive by', formatTime(r.arriveBy)]] as [string, string][]) : []),
    ['Leave by', `${formatTime(r.end + IDLE_GRACE_MS)}, then ${formatEuro(IDLE_CENTS_PER_MIN)}/min (max ${formatEuro(OVERSTAY_CAP_CENTS)})`],
    ...(r.status === 'walkup' ? [] : ([['Fee', `${formatEuro(r.feeCents)} · ${r.demand.toLowerCase()} demand${r.creditUsedCents ? ` · ${formatEuro(r.creditUsedCents)} credit used` : ''}`]] as [string, string][])),
    ...(r.cancelNowCents !== null
      ? ([['Cancelling now', r.cancelNowCents === 0 ? 'free' : `costs ${formatEuro(r.cancelNowCents)} (${cancelPercent(r, now)}%)`]] as [string, string][])
      : []),
    ...(r.bookedVia ? ([['Booked via', r.bookedVia]] as [string, string][]) : []),
  ];
  return (
    <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-muted">{k}</dt>
            <dd className="mt-0.5 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Plate({ r, onDark }: { r: ReservationView; onDark?: boolean }) {
  if (!r.vehicleLabel && !r.plateHint && !r.extraPlateHint) return null;
  return (
    <div className={`mt-6 flex flex-wrap items-center gap-3 pt-5 ${onDark ? 'border-t border-white/14' : 'border-t border-line'}`}>
      <CarFront aria-hidden className={`size-5 ${onDark ? 'text-on-brand-muted' : 'text-muted'}`} />
      {r.vehicleLabel && <span className="font-semibold">{r.vehicleLabel}</span>}
      {r.plateHint && <PlateBadge plate={r.plateHint} size="sm" />}
      {r.extraPlateHint && (
        <span className={`flex items-center gap-2 text-sm ${onDark ? 'text-on-brand-muted' : 'text-muted'}`}>
          and today <PlateBadge plate={r.extraPlateHint} size="sm" />
        </span>
      )}
    </div>
  );
}

function Upcoming({ r, now }: { r: ReservationView; now: number }) {
  const left = r.start - now;
  return (
    <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <span className={`${chipClass} bg-brand-tint text-brand-strong`}>Booked</span>
      <p className="mt-4 font-mono text-sm uppercase tracking-[0.08em] text-muted">Starts {day(r.start, now).toLowerCase() === 'today' ? 'today' : day(r.start, now)} at</p>
      <p className="mt-1 font-display text-8xl leading-[0.85]">{formatTime(r.start)}</p>
      <p className="mt-3 text-lg text-muted">
        In {duration(left)}. It goes live 30 minutes before the start, and the guard holds the bay until {formatTime(r.arriveBy)}.
      </p>
      <Plate r={r} />
      <div className="mt-6 border-t border-line pt-5">
        <CancelSchedule steps={r.cancelSchedule} noShowCents={r.feeCents} now={now} />
      </div>
    </section>
  );
}

function Live({ r, now, busy, onCheckIn }: { r: ReservationView; now: number; busy: string | null; onCheckIn: () => void }) {
  const before = now < r.start;
  return (
    <>
      {r.carAtBay && (
        <Banner tone="info" icon={ScanLine}>
          The camera saw a car but couldn’t read its plate. If that’s you, tap “I’m at the bay”.
        </Banner>
      )}
      <section className="rounded-3xl bg-brand-deep p-6 text-on-brand sm:p-8">
        <span className={`${chipClass} bg-signal text-ink`}>
          <span className="size-2 rounded-full bg-ink" /> Held for you
        </span>
        <p className="mt-4 font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted">{before ? `Starts at ${formatTime(r.start)}, in` : `Arrive by ${formatTime(r.arriveBy)}`}</p>
        <p className="mt-1 font-display text-8xl leading-[0.85] text-signal sm:text-9xl">{formatCountdown((before ? r.start : r.arriveBy) - now)}</p>
        <p className="mt-3 text-sm text-on-brand-muted">
          {before ? 'The guard keeps the bay free for you.' : 'left to arrive.'} When you drive in, the camera reads your plate and lowers the guard.
        </p>
        <Plate r={r} onDark />
      </section>
      {/* the fallback check-in only opens once the bay has seen a car (server-checked too) */}
      {r.carAtBay ? (
        <Button size="lg" loading={busy === 'checkin'} onClick={onCheckIn}>
          <MapPin aria-hidden className="size-5" /> I’m at the bay
        </Button>
      ) : (
        <p className="px-1 text-sm text-muted">Plate not read? Once the camera has seen your car, you can check in here.</p>
      )}
    </>
  );
}

function Blocked({
  r,
  from,
  busy,
  onCancel,
  onBookInstead,
}: {
  r: ReservationView;
  from: Bay | null;
  busy: string | null;
  onCancel: () => void;
  onBookInstead: (b: Bay) => void;
}) {
  return (
    <>
      <section className="rounded-3xl bg-warn-tint p-6 text-ink sm:p-8">
        <TriangleAlert aria-hidden className="size-8 text-warn" strokeWidth={1.5} />
        <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[0.012em]">Your bay is occupied</h2>
        <p className="mt-2 text-lg">
          Another car is in the bay. Your arrival deadline waits for as long as it’s there{r.real ? ', and we’ve alerted the operator' : ''}.
        </p>
        <p className="mt-1 text-muted">Since {formatTime(r.blockedSince ?? 0)}. Cancelling now is free.</p>
        {r.creditGrantedCents > 0 && (
          <p className="mt-4 rounded-2xl bg-surface px-4 py-3 font-semibold">{formatEuro(r.creditGrantedCents)} credit is on your account for the trouble. It’s used on your next booking.</p>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
        <h3 className="font-display text-2xl leading-none tracking-[0.012em]">Free chargers nearby</h3>
        <div className="mt-3">
          <AlternativeList bays={r.reroute?.alternatives ?? []} from={from} onBook={onBookInstead} />
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <Button variant="danger" loading={busy === 'cancel'} onClick={onCancel}>
            Cancel for free
          </Button>
        </div>
      </section>
    </>
  );
}

const CHECK_IN = {
  camera: 'The camera recognised your plate.',
  fuzzy: 'The camera recognised your plate, even though it misread a character.',
  fallback: 'You checked in at the bay yourself.',
  walkup: 'You unlocked the bay at the charger.',
};

function Arrived({ r, busy, onCharge }: { r: ReservationView; busy: string | null; onCharge: () => void }) {
  const how = r.checkInMethod === 'fallback' ? CHECK_IN.fallback : r.checkInMethod === 'walkup' ? CHECK_IN.walkup : r.matchedBy === 'fuzzy' ? CHECK_IN.fuzzy : CHECK_IN.camera;
  return (
    <>
      <section className="rounded-3xl bg-brand-deep p-6 text-on-brand sm:p-8">
        <CircleCheck aria-hidden className="size-9 text-mint" strokeWidth={1.5} />
        <h2 className="mt-3 font-display text-4xl leading-[0.9] tracking-[0.012em]">You’re checked in</h2>
        <p className="mt-2 text-lg">{how} The guard is down: park and plug in.</p>
        {r.arrivedAt && <p className="mt-2 font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted">Arrived at {formatTime(r.arrivedAt)}</p>}
      </section>
      <Button size="lg" loading={busy === 'charge'} onClick={onCharge}>
        <PlugZap aria-hidden className="size-5" /> Start charging
      </Button>
    </>
  );
}

// Charging, or a walk-up session: both end at r.end, then 5 free minutes, then the idle fee
function Session({ r, now, busy, onFinish }: { r: ReservationView; now: number; busy: string | null; onFinish: () => void }) {
  const left = r.end - now;
  const walkup = r.status === 'walkup';
  return (
    <>
      <section className="rounded-3xl bg-brand-deep p-6 text-on-brand sm:p-8">
        <span className={`${chipClass} bg-signal text-ink`}>
          <PlugZap aria-hidden className="size-4" /> {walkup ? 'Walk-up' : 'Charging'}
        </span>
        <p className="mt-4 font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted">
          {left > 0 ? `${walkup ? 'Free until' : 'Until'} ${formatTime(r.end)}, left` : 'Slot over'}
        </p>
        <p className="mt-1 font-display text-8xl leading-[0.85] text-signal sm:text-9xl">{left > 0 ? formatCountdown(left) : elapsed(now - r.end)}</p>
        <p className="mt-3 text-on-brand-muted">
          {left > 0
            ? walkup
              ? `The next booking starts after ${formatTime(r.end)}, so the bay is yours until then.`
              : `Charging since ${formatTime(r.chargingAt ?? r.start)}. When you drive off, the camera ends the session.`
            : now < r.end + IDLE_GRACE_MS
              ? `Your ${IDLE_GRACE_MS / MIN} free minutes to leave run until ${formatTime(r.end + IDLE_GRACE_MS)}.`
              : `The idle fee is running: ${formatEuro(IDLE_CENTS_PER_MIN)} a minute, up to ${formatEuro(OVERSTAY_CAP_CENTS)}.`}
        </p>
      </section>
      <Button size="lg" loading={busy === 'finish'} onClick={onFinish}>
        Finish and leave
      </Button>
    </>
  );
}

function doneText(r: ReservationView) {
  const over = r.charges.find((c) => c.kind === 'overstay');
  if (r.status === 'completed')
    return {
      title: 'Session complete',
      text: over ? `Thanks for charging. You stayed past the free minutes, so idle time was added: ${formatEuro(over.cents)}.` : 'Thanks for charging. The bay is free for the next driver.',
    };
  if (r.status === 'cancelled')
    return {
      title: 'Booking cancelled',
      text: r.totalCents ? `The bay is free again. Cancelling cost ${formatEuro(r.totalCents)}; the rest was returned.` : 'The bay is free again. Nothing was charged.',
    };
  return { title: 'You didn’t arrive in time', text: `You didn’t arrive by ${formatTime(r.arriveBy)}, so the bay went to the next driver. The ${formatEuro(r.feeCents)} fee is kept.` };
}

function Done({ r }: { r: ReservationView }) {
  const d = doneText(r);
  const rows = [
    ['Booked', formatTime(r.createdAt)],
    r.arrivedAt && ['Checked in', formatTime(r.arrivedAt)],
    r.chargingAt && r.endedAt && ['Charged for', duration(r.endedAt - r.chargingAt)],
  ].filter(Boolean) as [string, string][];
  return (
    <>
      <section className="rounded-2xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <h2 className="font-display text-4xl leading-[0.9] tracking-[0.012em]">{d.title}</h2>
        <p className="mt-2 text-lg text-muted">{d.text}</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-5 sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-2xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <h3 className="mb-4 font-display text-2xl leading-none tracking-[0.012em]">Receipt</h3>
        <Receipt charges={r.charges} totalCents={r.totalCents} />
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

function CancelDialog({ open, r, busy, onClose, onConfirm }: { open: boolean; r: ReservationView; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const fee = r.cancelNowCents ?? 0;
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this booking?">
      <p aria-live="polite" className="text-lg">
        {fee === 0 ? 'Cancelling now is free: you get everything back.' : `Cancelling now costs ${formatEuro(fee)}. The rest of what you paid comes back.`}
      </p>
      <p className="mt-2 text-muted">That’s always less than not turning up. The bay is free for other drivers straight away.</p>
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

// Another registered car, or a one-off plate for today (erased when the booking ends)
function OtherCarDialog({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (body: { vehicleId: string } | { plate: string; consent: true }) => void }) {
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [plate, setPlate] = useState('');
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    if (open) api<Vehicle[]>('GET', '/api/vehicles').then(setCars, () => {});
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Driving a different car?">
      <div className="grid gap-5">
        {cars.length > 1 && (
          <div>
            <p className="font-semibold">One of your cars</p>
            <ul className="mt-2 grid gap-2">
              {cars.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSubmit({ vehicleId: c.id })}
                    className="flex min-h-11 w-full items-center gap-4 rounded-2xl p-3 text-left ring-1 ring-line-strong hover:bg-brand-tint"
                  >
                    <PlateBadge plate={c.display} size="sm" />
                    <span className="font-medium">{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form
          className="grid gap-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onSubmit({ plate, consent: true });
          }}
        >
          <p className="text-muted">Or add today’s plate, and the camera lets that car in too. It’s forgotten when the booking ends.</p>
          <Field label="Today’s licence plate">
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              required
              maxLength={14}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="B XY 123"
              className={`${inputClass} font-mono text-lg font-semibold uppercase tracking-[0.06em]`}
            />
          </Field>
          <label className="flex min-h-11 cursor-pointer gap-3 rounded-2xl bg-sunken p-4">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
            <span>Use this plate to check me in for this booking only.</span>
          </label>
          <Button type="submit" size="lg" loading={busy} disabled={!plate.trim() || !consent}>
            Add plate
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
