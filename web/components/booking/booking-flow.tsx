'use client';

import { CarFront, Check, Construction, CreditCard, FlaskConical, TriangleAlert, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { hardwareNote, OFFLINE_TEXT } from '@/components/explore/panels';
import { formatTime, useNow } from '@/components/time';
import { Button, chipClass } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PlateBadge } from '@/components/ui/plate-badge';
import { VehicleForm } from '@/components/vehicles/vehicle-form';
import {
  ARM_MS,
  ARRIVAL_GRACE_MS,
  BLOCK_MS,
  CLASSES,
  earliestStart,
  FREE_CANCEL_MS,
  IDLE_CENTS_PER_MIN,
  IDLE_GRACE_MS,
  MAX_RESERVATION_CENTS,
  nowSlot,
  OVERSTAY_CAP_CENTS,
} from '@/lib/booking-rules';
import type { Availability, Bay, BayDetail, BaysResponse, Quote, ReservationView, ReserveRequest } from '@/lib/booking-types';
import { distanceM } from '@/lib/geo';
import { formatEuro } from '@/lib/pricing';
import type { Vehicle } from '@/lib/vehicles';
import { AlternativeList } from './alternatives';
import { CancelSchedule } from './cancel-schedule';
import { berlinDate, type Cell, DatePicker, DayTimeline, dayLabel, formatLength, freeRun, LengthPicker, quickLength } from './slot-picker';

// Why the server refused a booking (its messages are in lib/schedule.ts), so the flow can say what to do next
type Kind = 'price' | 'car' | 'taken' | 'limit' | 'fault' | 'barrier' | 'slot' | 'other';
const KINDS: [Kind, RegExp][] = [
  ['price', /price is now/i],
  ['car', /car is (over the arm|in the bay)|another car is in the bay/i],
  ['taken', /^taken|overlaps/i],
  ['limit', /upcoming bookings/i],
  ['fault', /out of order/i],
  ['barrier', /could not be reserved/i],
  ['slot', /quarter hour|already started|days ahead|at least one|bookings of up to/i],
];
type Problem = { kind: Kind; message: string };
const problemOf = (message: string): Problem => ({ kind: KINDS.find(([, re]) => re.test(message))?.[0] ?? 'other', message });

const NEARBY_DEG = 0.012; // the box searched for free chargers: about 1.3 km each way (east–west widened for Berlin)

// bw-1 and bw-2 are real locks: the barrier rises 10 minutes before the slot, or at once for a slot that close
export const barrierNote = (start: number, now: number) =>
  start - ARM_MS > now ? `The barrier goes up at ${formatTime(start - ARM_MS)}, ${ARM_MS / 60_000} minutes before your slot.` : 'The barrier goes up now.';

// Book any bay: car, day, start block, length, a live quote, accept, pay. The server re-checks everything.
// It opens on "Book now" (this moment, no picking); "Choose a time" brings in the day, start and length.
export function BookingFlow({ bay: initial, onClose }: { bay: Bay | null; onClose: () => void }) {
  const router = useRouter();
  const { state, refresh } = useAppState();
  const now = useNow();
  const [quick, setQuick] = useState(true);
  const [picked, setPicked] = useState<Bay | null>(null); // a free charger nearby that the driver switched to
  const [fresh, setFresh] = useState<Bay | null>(null); // the bay as the server sees it now, fetched on open and after an error
  const [cars, setCars] = useState<Vehicle[] | null>(null);
  const [carId, setCarId] = useState('');
  const [date, setDate] = useState(''); // '' is today
  const [avail, setAvail] = useState<Availability | null>(null);
  const [slot, setSlot] = useState<{ start: number | null; blocks: number }>({ start: null, blocks: 4 });
  const [quote, setQuote] = useState<{ key: string; q: Quote } | null>(null);
  const [acceptedFor, setAcceptedFor] = useState(''); // the price the box was ticked for: a new price needs a new tick
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [carSeen, setCarSeen] = useState(''); // a bay the server just said a car is standing in
  const [nearby, setNearby] = useState<Bay[] | null>(null);
  const [reload, setReload] = useState(0);
  const problemRef = useRef<HTMLDivElement>(null);

  const target = picked ?? initial;
  const bayId = target?.id ?? '';
  const isReal = !!target?.real;
  // the freshest status there is: the shell polls the Baywatch bays every 2 s, the others are fetched
  const bay = target && (state?.realBays?.find((b) => b.id === bayId) ?? (fresh?.id === bayId ? fresh : target));
  const open = !!target;
  const today = now ? berlinDate(now) : '';
  const day = date || today;
  const carInBay = !!bay && (bay.status === 'occupied' || carSeen === bay.id);
  const offline = bay?.status === 'offline';

  useEffect(() => {
    if (!open) return;
    api<Vehicle[]>('GET', '/api/vehicles').then(
      (list) => {
        setCars(list);
        setCarId((id) => id || list[0]?.id || '');
      },
      (e) => setLoadError((e as Error).message),
    );
  }, [open]);

  useEffect(() => {
    if (!bayId || isReal) return;
    let live = true;
    api<BayDetail>('GET', `/api/bays/${encodeURIComponent(bayId)}`).then(
      (b) => live && setFresh(b),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [bayId, isReal, reload]);

  useEffect(() => {
    if (!bayId || !day) return;
    let live = true;
    api<Availability>('GET', `/api/bays/${encodeURIComponent(bayId)}/availability?date=${day}`).then(
      (a) => live && setAvail(a),
      (e) => live && setLoadError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [bayId, day, reload]);

  // The day as it can be booked now: the server's grid, less the blocks that have started since, and less the
  // starts the guard would have to rise for at once while a car stands in the bay (only "now" is blocked)
  const cells = useMemo<Cell[] | null>(() => {
    if (!avail || avail.bayId !== bayId || avail.date !== day) return null;
    if (!now) return avail.blocks;
    const first = earliestStart(now);
    return avail.blocks.map((b): Cell =>
      b.state !== 'free' ? b : b.start < first ? { ...b, state: 'past' } : carInBay && b.start - ARM_MS <= now ? { ...b, state: 'occupied' } : b,
    );
  }, [avail, bayId, day, now, carInBay]);

  // the picker: the driver's start while it's free, else the next free one (or the day's first); an hour, or what fits
  const pick = cells && (cells.find((c) => c.state === 'free' && slot.start !== null && c.start >= slot.start) ?? cells.find((c) => c.state === 'free'));
  const fit = cells && pick ? freeRun(cells, cells.indexOf(pick)) : 0;
  const maxBlocks = avail?.maxBlocks ?? 16;
  // "Book now": this moment, from the block under way for at least an hour (the server sets the same slot, nowSlot),
  // or the later start the driver moved to
  const asNow = quick && slot.start === null;
  const nowS = asNow && now ? nowSlot(target?.class ?? 'fast', now) : null;
  const start = nowS ? nowS.start : quick ? slot.start : pick ? pick.start : null;
  const blocks = nowS ? nowS.blocks : quick ? quickLength(target?.class ?? 'fast') : Math.max(1, Math.min(slot.blocks, maxBlocks, fit || 1));
  const firstFree = cells?.find((c) => c.state === 'free')?.start;
  // when that start can't be booked (a car in the bay, a booking or its gap): the next start with room for the length
  const next = quick && cells && start !== null ? cells.find((c, i) => c.start > start && c.state === 'free' && freeRun(cells, i) >= blocks) : undefined;

  // a fresh quote for every change, a moment after the last one ("Book now": again when the next block begins)
  const quoteKey = `${bayId}:${asNow ? 'now' : 'at'}:${start}:${blocks}:${reload}`;
  useEffect(() => {
    if (!bayId || start === null) return;
    let live = true;
    const t = setTimeout(() => {
      api<Quote>('GET', `/api/bays/${encodeURIComponent(bayId)}/quote?start=${asNow ? 'now' : start}&blocks=${blocks}`).then(
        (q) => live && setQuote({ key: quoteKey, q }),
        (e) => live && setLoadError((e as Error).message),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [asNow, bayId, blocks, quoteKey, start]);
  const shown = quote && quote.q.bayId === bayId && start !== null ? quote.q : null; // the last quote stays, dimmed, while the next loads
  const quoting = start !== null && quote?.key !== quoteKey;
  const priceKey = shown ? `${shown.cents}:${shown.payCents}` : '';
  const accepted = !!priceKey && acceptedFor === priceKey;

  // one tap to that next start; the driver still accepts the price and pays
  const movable = (message?: string) => !!message && ['car', 'taken', 'slot'].includes(problemOf(message).kind);
  const moveOn = next && !quoting && (
    <Button
      variant="secondary"
      onClick={() => {
        setSlot((s) => ({ ...s, start: next.start }));
        setProblem(null);
      }}
    >
      Start at {formatTime(next.start)} instead
    </Button>
  );
  const nothingLater = cells && !next && 'Nothing later today has room for it. Choose a time on another day.';

  // a refusal shows next to the Pay button: bring it into view, wherever the dialog was scrolled to
  useEffect(() => {
    if (problem) problemRef.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [problem]);

  function startOver() {
    setFresh(null);
    setAvail(null);
    setQuote(null);
    setAcceptedFor('');
    setProblem(null);
    setCarSeen('');
    setNearby(null);
    setLoadError('');
  }

  function close() {
    startOver();
    setPicked(null);
    setQuick(true);
    setSlot({ start: null, blocks: 4 });
    setDate('');
    onClose();
  }

  // "Book now" on a free charger nearby: the same day, start and length at that bay (from "Book now", its earliest start)
  function switchTo(b: Bay) {
    startOver();
    if (quick) setSlot((s) => ({ ...s, start: null }));
    setPicked(b);
  }

  async function findNearby(b: Bay) {
    const box = [b.lat - NEARBY_DEG, b.lng - NEARBY_DEG * 1.6, b.lat + NEARBY_DEG, b.lng + NEARBY_DEG * 1.6].map((v) => v.toFixed(4));
    try {
      const r = await api<BaysResponse>('GET', `/api/bays?sw_lat=${box[0]}&sw_lng=${box[1]}&ne_lat=${box[2]}&ne_lng=${box[3]}`);
      const free = new Map<string, Bay>();
      for (const x of [...r.realBays, ...r.bays]) if (x.id !== b.id && x.led === 'green') free.set(x.id, x);
      setNearby([...free.values()].sort((x, y) => distanceM(b, x) - distanceM(b, y)).slice(0, 3));
    } catch {
      setNearby([]);
    }
  }

  async function book() {
    if (!bay || !shown || start === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const slotOf = asNow ? { now: true as const } : { start, blocks };
      const body: ReserveRequest = { bayId: bay.id, ...slotOf, vehicleId: carId, priceCents: shown.cents, acceptFees: true, payment: 'demo' };
      const r = await api<ReservationView>('POST', '/api/reservations', body);
      await refresh();
      router.push(`/booking/${encodeURIComponent(r.id)}`);
    } catch (e) {
      const p = problemOf((e as Error).message);
      setProblem(p);
      if (p.kind === 'car') setCarSeen(bay.id);
      if (p.kind === 'car' || p.kind === 'fault') void findNearby(bay);
      // the bay, the day and the price again: a new price shows at once, a taken start moves to the next free one
      setReload((n) => n + 1);
      setBusy(false);
    }
  }

  // what to do about a refusal, in the driver's terms
  function nextStep(p: Problem): ReactNode {
    if (quick && movable(p.message))
      return `${next ? `The next start with room is ${formatTime(next.start)}.` : (nothingLater ?? '')}${p.kind === 'car' ? ' Or book a free charger nearby.' : ''}`;
    switch (p.kind) {
      case 'price':
        return 'Tick the box to accept the new price, then book.';
      case 'car':
        return start !== null ? `We’ve moved your start to ${formatTime(start)}. Book that, or a free charger nearby.` : 'Pick another day, or book a free charger nearby.';
      case 'taken':
        return start !== null ? `We’ve moved your start to ${formatTime(start)}, the next free time. Check it, then book again.` : 'Nothing is free on this day any more. Pick another day.';
      case 'limit':
        return (
          <Link href="/bookings" className="font-semibold underline underline-offset-2">
            See your bookings
          </Link>
        );
      case 'fault':
        return 'Book a free charger nearby instead.';
      case 'barrier':
        return 'Nothing was booked. Wait a minute and try again, or pick a later start.';
      case 'slot':
        return 'Pick another start or length, then book again.';
      default:
        return 'Nothing was booked. Try again, or pick another start.';
    }
  }

  return (
    <Dialog open={open} onClose={close} title={bay ? `Book ${bay.name}` : 'Book'}>
      {bay && (
        <div className="grid gap-7">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono text-xs uppercase tracking-[0.08em]">
              {CLASSES[bay.class].label} · {bay.powerKw} kW
            </span>
            {bay.guard === 'simulated' && (
              <span className={`${chipClass} bg-accent-tint text-accent`}>
                <FlaskConical aria-hidden className="size-3.5" /> {hardwareNote(bay)}
              </span>
            )}
          </p>

          {offline && (
            <p role="status" className="flex gap-3 rounded-2xl bg-warn-tint p-4 font-semibold text-ink">
              <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
              {OFFLINE_TEXT}
            </p>
          )}
          {!quick && carInBay && day === today && (
            <p role="status" className="flex gap-3 rounded-2xl bg-warn-tint p-4 text-ink">
              <CarFront aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
              <span>
                <span className="font-semibold">A car is in the bay right now,</span> so it can’t be booked from now.
                {cells && (firstFree ? ` The earliest start today is ${formatTime(firstFree)}.` : ' Pick another day.')}
              </span>
            </p>
          )}

          {cars === null && !loadError && <div className="h-24 animate-pulse rounded-2xl bg-sunken" />}
          {cars?.length === 0 && (
            <div>
              <p className="mb-5 text-muted">Add the car you’re driving. The camera at the bay uses its plate to let you in.</p>
              <VehicleForm
                submitLabel="Add car and continue"
                onAdded={(v) => {
                  setCars([v]);
                  setCarId(v.id);
                }}
              />
            </div>
          )}

          {cars && cars.length > 0 && (
            <>
              <fieldset>
                <legend className="font-semibold">Which car?</legend>
                <div className="mt-3 grid gap-2">
                  {cars.map((c) => (
                    <label
                      key={c.id}
                      className="flex min-h-11 cursor-pointer items-center gap-4 rounded-2xl p-4 ring-1 ring-line-strong transition-shadow has-checked:bg-brand-tint has-checked:ring-2 has-checked:ring-brand has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
                    >
                      <input type="radio" name="car" value={c.id} checked={carId === c.id} onChange={() => setCarId(c.id)} className="sr-only" />
                      <PlateBadge plate={c.display} size="sm" />
                      <span className="flex-1 font-medium">{c.label}</span>
                      {carId === c.id && <Check aria-hidden className="size-5 text-ink" />}
                    </label>
                  ))}
                </div>
              </fieldset>

              {!quick && today && (
                <DatePicker
                  value={day}
                  today={today}
                  onChange={(d) => {
                    setDate(d);
                    setProblem(null);
                  }}
                />
              )}

              {quick ? null : cells ? (
                <DayTimeline
                  blocks={cells}
                  start={start}
                  length={blocks}
                  onPick={(s) => {
                    setSlot((cur) => ({ ...cur, start: s }));
                    setProblem(null);
                  }}
                />
              ) : (
                <div className="h-64 animate-pulse rounded-2xl bg-sunken" />
              )}

              {!quick && cells && start !== null && (
                <LengthPicker
                  blocks={blocks}
                  maxBlocks={maxBlocks}
                  fit={fit}
                  onChange={(n) => {
                    setSlot((cur) => ({ start: cur.start ?? start, blocks: n }));
                    setProblem(null);
                  }}
                />
              )}

              {start !== null && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p aria-live="polite" className="flex-1 rounded-2xl bg-sunken px-4 py-3 font-mono text-sm uppercase tracking-[0.06em]">
                    {asNow
                      ? `Starts now · until ${formatTime(start + blocks * BLOCK_MS)}`
                      : `${dayLabel(day)} · ${formatTime(start)}–${formatTime(start + blocks * BLOCK_MS)} · ${formatLength((blocks * BLOCK_MS) / 60_000)}`}
                  </p>
                  {quick && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuick(false);
                        setProblem(null);
                      }}
                      className="min-h-11 rounded-lg px-1 font-semibold text-accent underline underline-offset-2 hover:text-ink"
                    >
                      Choose a time
                    </button>
                  )}
                </div>
              )}

              {start !== null && (
                <section aria-live="polite" aria-busy={quoting} className={`grid gap-5 transition-opacity ${quoting ? 'opacity-60' : ''}`}>
                  {shown ? (
                    <>
                      <div>
                        <h3 className="font-semibold">Price</h3>
                        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                          <span className="font-display text-5xl leading-none tracking-[0.012em]">{formatEuro(shown.cents)}</span>
                          <span className={`${chipClass} ${shown.demand === 'Busy' || shown.demand === 'Peak' ? 'bg-warn-tint text-warn' : 'bg-brand-tint text-brand-strong'}`}>
                            {shown.demand} demand
                          </span>
                          <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted">
                            {CLASSES[shown.class].label} · {shown.multiplier}×
                          </span>
                        </p>
                        <p className="mt-2 text-sm text-muted">
                          Never more than {formatEuro(MAX_RESERVATION_CENTS)}. Fixed once you book. Charging itself is paid at the charger, as usual.
                        </p>
                        {shown.creditAppliedCents > 0 && (
                          <p className="mt-3 flex flex-wrap justify-between gap-2 rounded-2xl bg-brand-tint px-4 py-3 font-semibold">
                            <span>{state?.viewer?.firstFree && shown.payCents === 0 ? 'Your first reservation is free' : 'Credit applied'}</span>
                            <span className="font-mono">−{formatEuro(shown.creditAppliedCents)}</span>
                          </p>
                        )}
                      </div>
                      {shown.valid ? (
                        quick ? (
                          <FeeRules q={shown} now={now} />
                        ) : (
                          <CancelSchedule steps={shown.cancelSchedule} noShowCents={shown.noShowCents} now={now} />
                        )
                      ) : (
                        // with "Book now" a refusal at Pay says the same, next to the button
                        !(quick && problem) && (
                          <div className="grid gap-3 rounded-2xl bg-warn-tint p-4">
                            <p role="alert" className="flex gap-3 font-semibold text-ink">
                              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
                              {shown.reason ?? 'This slot can’t be booked. Pick another start or length.'}
                            </p>
                            {quick && movable(shown.reason) && (moveOn || (nothingLater && <p className="pl-8 text-ink">{nothingLater}</p>))}
                          </div>
                        )
                      )}
                    </>
                  ) : (
                    <div className="h-40 animate-pulse rounded-2xl bg-sunken" />
                  )}
                </section>
              )}

              {(shown || problem) && (
                <div className="grid gap-4">
                  {/* bw-1 and bw-2 are real locks: booking them really moves the barrier */}
                  {bay.guard === 'hardware' && shown?.valid && (
                    <p className="flex gap-3 rounded-2xl bg-sunken p-4 text-ink">
                      <Construction aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                      <span>
                        <span className="font-semibold">This raises the real barrier at the bay.</span>
                        {start !== null && now ? ` ${barrierNote(start, now)}` : ''}
                      </span>
                    </p>
                  )}
                  {shown?.valid && (
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(e) => setAcceptedFor(e.target.checked ? priceKey : '')}
                        className="mt-0.5 size-5 shrink-0 accent-brand"
                      />
                      <span className="font-medium">I accept these fees and the cancellation steps</span>
                    </label>
                  )}

                  {problem && (
                    <div ref={problemRef} className="grid gap-3 rounded-2xl bg-danger-tint p-4">
                      <div role="alert" className="grid gap-1.5">
                        <p className="flex gap-3 font-semibold text-danger">
                          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
                          {problem.message}
                        </p>
                        <p className="pl-8 text-ink">{nextStep(problem)}</p>
                      </div>
                      {quick && movable(problem.message) && moveOn && <div className="pl-8">{moveOn}</div>}
                      {(problem.kind === 'car' || problem.kind === 'fault') && (
                        <div className="rounded-xl bg-surface px-4 text-ink">
                          {nearby ? <AlternativeList bays={nearby} from={bay} onBook={switchTo} /> : <p className="py-3 text-muted">Looking for free chargers nearby…</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {shown && (
                    <div>
                      <Button
                        size="lg"
                        className="w-full"
                        loading={busy}
                        disabled={!carId || !shown.valid || !accepted || quoting || offline}
                        onClick={book}
                      >
                        <CreditCard aria-hidden className="size-5" /> {shown.payCents === 0 ? 'Book for free' : `Pay ${formatEuro(shown.payCents)} and book`}
                      </Button>
                      <p className="mt-2 text-center font-mono text-xs uppercase tracking-[0.08em] text-muted">Demo payment: no card is charged.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {loadError && (
            <p role="alert" className="flex gap-3 rounded-2xl bg-danger-tint p-4 text-danger">
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
              {loadError}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// "Book now" keeps the fee rules to three lines; "Choose a time" shows every cancellation step. The arrival grace
// counts from the start, or from booking for a slot already under way (schedule.ts: arriveBy).
function FeeRules({ q, now }: { q: Quote; now: number }) {
  const paid = q.cancelSchedule.map((s) => s.percent).filter((p) => p > 0);
  const [lo, hi] = [Math.min(...paid), Math.max(...paid)];
  return (
    <div>
      <h3 className="font-semibold">Fee rules</h3>
      <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm marker:text-faint">
        <li>
          Free to cancel for {FREE_CANCEL_MS / 60_000} minutes{paid.length > 0 && `, then ${lo === hi ? hi : `${lo}–${hi}`}% of the fee`}.
        </li>
        <li>
          Not checked in by {formatTime(Math.max(q.start, now) + ARRIVAL_GRACE_MS)}: the full {formatEuro(q.noShowCents)} as a no-show.
        </li>
        <li>
          After {formatTime(q.end)}: {IDLE_GRACE_MS / 60_000} free minutes to leave, then {formatEuro(IDLE_CENTS_PER_MIN)} a minute, up to{' '}
          {formatEuro(OVERSTAY_CAP_CENTS)}.
        </li>
      </ul>
    </div>
  );
}
