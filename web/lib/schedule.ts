// Booking v2 (booking-v2-spec.md): every bay's schedule on the 15-min grid, in memory, for one server process.
// A booking: upcoming → live (from start − 30 min) → arrived (checked in, guard down) → charging → completed,
// or cancelled / no_show. A walk-up (unlocked at the bay without a booking): walkup → completed.
// Hardware bays (a real Ecurious lock): the arm is up between sessions. It's raised for a booking from
// start − 10 min (at booking time for a slot starting sooner, where a refusal undoes the booking), lowered on a
// plate match, a fallback check-in or a walk-up, and raised again once that session's car has left. Simulated bays
// keep the same states in memory. Plates are erased when a booking ends and only ever shown masked.

import {
  ARM_MS,
  ARRIVAL_GRACE_MS,
  BLOCK_MS,
  BLOCKED_CREDIT_CENTS,
  blockStart,
  bookingFee,
  cancelCents,
  cancelSchedule,
  clash,
  CLASSES,
  dayBlocks,
  demandAt,
  earliestStart,
  FREE_CANCEL_MS,
  HORIZON_MS,
  idleFee,
  idleMinutes,
  LIVE_MS,
  MAX_UPCOMING,
  MIN_GAP_MS,
  noShowCents,
  reminderTimes,
  slotProblem,
  WALKUP_CLEAR_MS,
} from './booking-rules.ts';
import type {
  Availability,
  Bay,
  BlockState,
  BookingsResponse,
  Charge,
  DemandLabel,
  DemandLevel,
  Quote,
  ReminderKey,
  ReservationStatus,
  ReservationView,
  Wallet,
} from './booking-types.ts';
import type { BayInfo } from './bays.ts';
import type { Payment } from './payments.ts';
import { fail } from './errors.ts';
import { distanceM } from './geo.ts';
import { maskPlate, normalizePlate, samePlate } from './plates.ts';
import { formatEuro, RECEIPT, total } from './pricing.ts';

export const EVIDENCE_MS = 3 * 60_000; // how recently the bay must have seen a car: fallback check-in, walk-up
export const GEOFENCE_M = 150;
const HISTORY_CAP = 1000; // ended bookings kept for receipts and the operator's week
const KNOWN_BAYS_CAP = 5000; // GoingElectric bays remembered from map searches
const ARM_RETRY_MS = 30_000; // matches the adapter's command cooldown

// The adapter for real locks (lib/ecurious.ts). It keeps every safety check: never raises onto a car, refuses
// an offline bay, cools down after a failed command, never retries a write.
export interface Hardware {
  raise(lockId: string, plates: string[]): Promise<unknown>;
  lower(lockId: string): Promise<unknown>;
  setPlates(lockId: string, plates: string[]): Promise<unknown>; // the camera's own allow-list, while armed
  status(lockId: string): Promise<{ state: string; mock: boolean; online?: boolean; carPresence?: 'occupied' | 'vacant' | null }>;
}

// Credit per driver: Clerk privateMetadata in the app (server.ts), a Map in tests
export interface WalletStore {
  load(userId: string): Promise<Wallet>;
  save(userId: string, wallet: Wallet): Promise<void>;
}

type Status = 'booked' | 'arrived' | 'charging' | 'completed' | 'cancelled' | 'no_show';
const OPEN: Status[] = ['booked', 'arrived', 'charging'];
const IN_BAY: Status[] = ['arrived', 'charging'];

export interface Booking {
  id: string;
  bayId: string;
  bay: Pick<BayInfo, 'name' | 'real' | 'guard' | 'class'>; // as it was when booked
  ownerId: string; // a Clerk user id, `partner:<name>:<uid>`, or `sim:` for demo data. Never sent to clients.
  kind: 'booking' | 'walkup';
  status: Status;
  plate: string | null; // erased when the booking ends
  extraPlate: string | null; // "different car today", erased with it
  vehicleLabel: string;
  createdAt: number;
  start: number;
  end: number;
  blocks: number;
  feeCents: number;
  demand: DemandLabel;
  creditUsedCents: number;
  firstFreeUsed: boolean;
  creditGrantedCents: number;
  blockedSince: number | null;
  blockedMs: number;
  unreadableAt?: number; // the camera saw a car it couldn't read: evidence for the fallback check-in
  presenceAt?: number; // the car sensor saw a car: the same evidence
  arrivedAt?: number;
  chargingAt?: number;
  endedAt?: number;
  checkInMethod?: 'camera' | 'fallback' | 'walkup';
  matchedBy?: 'exact' | 'fuzzy';
  reminders: { key: ReminderKey; at: number }[]; // still to fall due
  sentReminders: { key: ReminderKey; at: number }[];
  charges: Charge[];
  armed: boolean; // the arm was raised for this booking
  armTriedAt?: number;
  reroute?: string[]; // bay ids of free alternatives while blocked
  partner?: string;
  paymentIntentId?: string; // a card hold, for lib/payments.ts
  payment?: Payment;
  simulated?: boolean; // "Simulate a week" demo data
}

export type Alert = {
  id: string;
  bayId: string;
  since: number;
  bookingId: string;
  plate: string | null; // operators only; erased on resolve and never emailed
  status: 'open' | 'resolved';
  resolvedAt?: number;
  resolvedBy?: 'camera' | 'sensor' | 'operator';
  emailStatus: 'pending' | 'sent' | 'skipped' | 'failed';
  simulated?: boolean;
};
export type LogEntry = { at: number; type: string; detail: string; bayId?: string }; // never holds a plate

type Site = {
  blocker: { since: number } | null; // a car without a booking is in the bay
  seenAt: number; // when the camera or the sensor last saw a car (walk-up evidence)
  occupied: boolean; // simulated bays: the demo's "car in bay"
  loweredForSession: boolean; // the arm went down for a session: raise it once that car has left
  hw?: { online: boolean; carPresence: 'occupied' | 'vacant' | null; mock: boolean }; // the lock, as last read
};

const REMINDER_NOTES: Record<ReminderKey, string> = {
  day_before: 'driver reminded: booking tomorrow',
  live: 'driver reminded: the booking is live',
  five_before: 'driver reminded: 5 min to the start',
  five_left: 'driver reminded: 5 min of the session left',
  slot_over: 'driver reminded: the slot is over, 5 free minutes',
  idle_fee: 'driver reminded: the idle fee has started',
};
const BEFORE_START: ReminderKey[] = ['day_before', 'live', 'five_before'];
const NO_WALLET: Wallet = { creditCents: 0, firstFree: false };
const CAR_IN_BAY = /car is (over the arm|in the bay)/i; // the adapter's (and the simulated guard's) refusal
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hasWallet = (ownerId: string) => ownerId.startsWith('user_');
const time = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

export function createSchedule({
  bays: initial,
  hw,
  wallets: store,
  now = Date.now,
  holidays = [],
  onAlert = () => {},
  onEnd = () => {},
  nearby = async () => [],
}: {
  bays: BayInfo[]; // the Baywatch bays; GoingElectric bays are added as drivers find them (knowBay)
  hw: Hardware;
  wallets: WalletStore;
  now?: () => number;
  holidays?: string[]; // YYYY-MM-DD, priced as busy
  onAlert?: (alert: Alert, bay: BayInfo) => void; // a blocked Baywatch bay: email the operator
  onEnd?: (booking: Booking) => void; // every end state, once the receipt is final (card payments settle here)
  nearby?: (bay: BayInfo) => Promise<BayInfo[]>; // candidates for re-routing a blocked booking
}) {
  const bays = new Map<string, BayInfo>(initial.map((b) => [b.id, b]));
  const sites = new Map<string, Site>();
  const all: Booking[] = [];
  const alerts: Alert[] = [];
  const log: LogEntry[] = [];
  const wallets = new Map<string, Wallet>();
  const loading = new Map<string, Promise<Wallet>>();
  const saving = new Map<string, Promise<void>>();
  let demand: DemandLevel | null = null; // the demo's "Site demand" override
  let ticking = false;

  const note = (type: string, detail = '', bayId?: string) => {
    log.unshift({ at: now(), type, detail, ...(bayId && { bayId }) });
    log.length = Math.min(log.length, 50);
  };
  const site = (bayId: string) => {
    let s = sites.get(bayId);
    if (!s) sites.set(bayId, (s = { blocker: null, seenAt: 0, occupied: false, loweredForSession: false }));
    return s;
  };
  const bayOf = (id: string) => bays.get(id) ?? fail(404, 'Unknown bay');
  const open = (bayId: string) => all.filter((b) => b.bayId === bayId && OPEN.includes(b.status)).sort((a, b) => a.start - b.start);
  const inBay = (bayId: string) => all.find((b) => b.bayId === bayId && IN_BAY.includes(b.status));
  const arriveBy = (b: Booking) => b.start + ARRIVAL_GRACE_MS + b.blockedMs + (b.blockedSince === null ? 0 : now() - b.blockedSince);
  const isLive = (b: Booking) => b.status === 'booked' && now() >= b.start - LIVE_MS && now() <= arriveBy(b);
  const liveOn = (bayId: string) => open(bayId).find(isLive);
  const upcomingOf = (ownerId: string) => all.filter((b) => b.ownerId === ownerId && b.status === 'booked');
  const addCharge = (b: Booking, kind: Charge['kind'], label: string, cents: number) => b.charges.push({ kind, label, cents, at: now() });
  const plates = (b: Booking) => [b.plate, b.extraPlate].filter((p): p is string => !!p);

  // A GoingElectric bay found on the map, so it can be booked by id. Baywatch bays are never replaced.
  function knowBay(info: BayInfo) {
    if (bays.get(info.id)?.real) return bays.get(info.id)!;
    bays.delete(info.id);
    bays.set(info.id, info);
    if (bays.size > KNOWN_BAYS_CAP) for (const [id, b] of bays) if (!b.real && !all.some((x) => x.bayId === id)) { bays.delete(id); break; }
    return info;
  }

  // Locks not in the team's list (checked at start-up, ecurious.ts) lose their hardware: never called again
  function dropLocks(valid: string[]) {
    for (const b of bays.values()) {
      if (b.lockId && !valid.includes(b.lockId)) {
        note('hardware', `${b.lockId} isn’t one of the team’s locks: ${b.name} runs without hardware`, b.id);
        bays.set(b.id, { ...b, lockId: undefined, guard: 'simulated' });
      }
    }
  }

  // ── Credit ──────────────────────────────────────────────────────────────────────────────────────
  async function walletOf(ownerId: string): Promise<Wallet> {
    if (!hasWallet(ownerId)) return { ...NO_WALLET };
    const known = wallets.get(ownerId);
    if (known) return known;
    let p = loading.get(ownerId);
    if (!p) {
      p = store
        .load(ownerId)
        .then((w) => wallets.get(ownerId) ?? (wallets.set(ownerId, { ...w }), wallets.get(ownerId)!))
        .finally(() => loading.delete(ownerId));
      loading.set(ownerId, p);
    }
    return p;
  }
  // Writes go out one at a time per driver, in order
  function persist(ownerId: string) {
    const w = { ...wallets.get(ownerId)! };
    const next = (saving.get(ownerId) ?? Promise.resolve()).catch(() => {}).then(() => store.save(ownerId, w));
    saving.set(ownerId, next);
    return next;
  }
  function grantCredit(b: Booking) {
    if (b.creditGrantedCents) return;
    b.creditGrantedCents = BLOCKED_CREDIT_CENTS;
    if (!hasWallet(b.ownerId)) return;
    void walletOf(b.ownerId)
      .then((w) => {
        w.creditCents += BLOCKED_CREDIT_CENTS;
        return persist(b.ownerId);
      })
      .catch((e) => note('error', `the €5 credit could not be saved: ${message(e)}`, b.bayId));
  }

  // ── Views ───────────────────────────────────────────────────────────────────────────────────────
  function bayView(info: BayInfo): Bay {
    const t = now();
    const st = site(info.id);
    const o = open(info.id);
    const next = o.find((b) => b.status === 'booked' && b.start > t);
    const offline = !!info.fault || (!!info.lockId && st.hw?.online === false);
    const occupied = !!inBay(info.id) || !!st.blocker || st.occupied || (!!info.lockId && st.hw?.carPresence === 'occupied');
    const status = offline ? 'offline' : occupied ? 'occupied' : o.some(isLive) ? 'reserved' : 'free';
    const soon = o.some((b) => b.status === 'booked' && b.start - t < WALKUP_CLEAR_MS + MIN_GAP_MS);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the lock id and the fault flag stay on the server
    const { lockId, fault, ...pub } = info;
    return {
      ...pub,
      status,
      led: status === 'free' && !soon ? 'green' : 'red',
      ...(next && { nextBookingAt: next.start }),
      priceFromCents: bookingFee(info.class, demand ?? 'quiet').cents,
    };
  }

  function phase(b: Booking): ReservationStatus {
    if (b.status === 'booked') return now() >= b.start - LIVE_MS ? 'live' : 'upcoming';
    if (IN_BAY.includes(b.status) && b.kind === 'walkup') return 'walkup';
    return b.status as ReservationStatus;
  }

  const evidence = (b: Booking) => {
    const seen = Math.max(b.unreadableAt ?? 0, b.presenceAt ?? 0);
    return seen > 0 && now() - seen <= EVIDENCE_MS;
  };

  function view(b: Booking): ReservationView {
    const t = now();
    const cancellable = b.status === 'booked' && t <= arriveBy(b);
    return {
      id: b.id,
      bayId: b.bayId,
      bayName: b.bay.name,
      real: b.bay.real,
      guard: b.bay.guard,
      class: b.bay.class,
      start: b.start,
      end: b.end,
      blocks: b.blocks,
      status: phase(b),
      arriveBy: arriveBy(b),
      feeCents: b.feeCents,
      demand: b.demand,
      charges: b.charges.map((c) => ({ ...c })),
      totalCents: total(b.charges),
      creditUsedCents: b.creditUsedCents,
      creditGrantedCents: b.creditGrantedCents,
      cancelNowCents: cancellable ? cancelCents(b.feeCents, { bookedAt: b.createdAt, start: b.start, at: t, blocked: b.blockedSince !== null }) : null,
      cancelSchedule: b.kind === 'booking' ? cancelSchedule(b.feeCents, b.createdAt, b.start) : [],
      createdAt: b.createdAt,
      ...(b.blockedSince !== null && { blockedSince: b.blockedSince }),
      ...(b.reroute && { reroute: { alternatives: b.reroute.flatMap((id) => (bays.get(id) ? [bayView(bays.get(id)!)] : [])) } }),
      ...(b.status === 'booked' && { carAtBay: isLive(b) && (!bays.get(b.bayId)?.lockId || evidence(b)) }),
      ...(b.plate && { plateHint: maskPlate(b.plate) }),
      ...(b.extraPlate && { extraPlateHint: maskPlate(b.extraPlate) }),
      vehicleLabel: b.vehicleLabel,
      ...(b.arrivedAt && { arrivedAt: b.arrivedAt }),
      ...(b.chargingAt && { chargingAt: b.chargingAt }),
      ...(b.endedAt && { endedAt: b.endedAt }),
      ...(b.checkInMethod && { checkInMethod: b.checkInMethod }),
      ...(b.matchedBy && { matchedBy: b.matchedBy }),
      sentReminders: b.sentReminders.map((r) => ({ ...r })),
      ...(b.partner && { bookedVia: b.partner }),
    };
  }

  // ── Quote and booking ───────────────────────────────────────────────────────────────────────────
  // A slot's problem beyond the grid rules: out of order, taken (with the gap), or the driver's limit
  function conflict(ownerId: string | null, bay: BayInfo, start: number, end: number) {
    if (bay.fault) return 'This charger is reported out of order';
    if (open(bay.id).some((b) => clash(start, end, b.start, b.end))) return 'Taken: this slot overlaps another booking or its 10-minute gap';
    if (ownerId && upcomingOf(ownerId).length >= MAX_UPCOMING) return `You can have up to ${MAX_UPCOMING} upcoming bookings. Cancel one to book another.`;
    return null;
  }

  function priced(bay: BayInfo, start: number) {
    return bookingFee(bay.class, demandAt(start, { override: demand, holidays }));
  }

  function quoteWith(viewerId: string | null, bayId: string, start: number, blocks: number, w: Wallet): Quote {
    const bay = bayOf(bayId);
    const t = now();
    const fee = priced(bay, start);
    const end = start + blocks * BLOCK_MS;
    const reason = slotProblem(bay.class, start, blocks, t) ?? conflict(viewerId, bay, start, end);
    const credit = w.firstFree ? fee.cents : Math.min(w.creditCents, fee.cents);
    return {
      bayId,
      start,
      end,
      blocks,
      class: bay.class,
      cents: fee.cents,
      demand: fee.demand,
      multiplier: fee.multiplier,
      creditAppliedCents: credit,
      payCents: fee.cents - credit,
      noShowCents: noShowCents(fee.cents),
      cancelSchedule: cancelSchedule(fee.cents, t, start),
      valid: !reason,
      ...(reason && { reason }),
    };
  }

  async function quoteSlot(viewerId: string | null, bayId: string, start: number, blocks: number): Promise<Quote> {
    bayOf(bayId);
    return quoteWith(viewerId, bayId, start, blocks, viewerId ? await walletOf(viewerId) : NO_WALLET);
  }

  // The same quote without waiting, for callers that quote many slots in a row (voice): the driver's credit is
  // used only once their wallet is loaded, and a first call starts loading it
  function quoteNow(viewerId: string | null, bayId: string, start: number, blocks: number): Quote & { creditKnown: boolean } {
    bayOf(bayId);
    const w = viewerId && hasWallet(viewerId) ? wallets.get(viewerId) : NO_WALLET;
    if (viewerId && !w) void walletOf(viewerId).catch(() => {});
    return { ...quoteWith(viewerId, bayId, start, blocks, w ?? NO_WALLET), creditKnown: !!w };
  }

  // The arm goes up for a booking. A refusal throws: at booking time it undoes the booking, in the tick it blocks.
  async function arm(b: Booking) {
    const bay = bays.get(b.bayId)!;
    const st = site(b.bayId);
    b.armTriedAt = now();
    if (bay.lockId) await hw.raise(bay.lockId, plates(b));
    else if (st.occupied || st.blocker || inBay(b.bayId)) throw new Error('A car is in the bay, so the guard did not rise');
    b.armed = true;
  }

  type ReserveInput = {
    bayId: string;
    start: unknown;
    blocks: unknown;
    plate: unknown;
    vehicleLabel: string;
    expectedCents?: unknown; // the price the driver saw: a different one now is a 409
    partner?: string;
    paymentIntentId?: string;
  };

  async function reserve(ownerId: string, input: ReserveInput): Promise<ReservationView> {
    const bay = bayOf(input.bayId);
    const plate = normalizePlate(input.plate);
    if (plate.length < 2 || plate.length > 10) fail(400, 'Enter a valid license plate');
    const start = Number(input.start);
    const blocks = Number(input.blocks);
    const slot = slotProblem(bay.class, start, blocks, now());
    if (slot) fail(400, slot);
    const w = hasWallet(ownerId) ? await walletOf(ownerId) : null;
    // from here to the hardware call nothing awaits, so a second request can't take the same slot
    const t = now();
    const end = start + blocks * BLOCK_MS;
    const taken = conflict(ownerId, bay, start, end);
    if (taken) fail(409, taken);
    const fee = priced(bay, start);
    if (input.expectedCents !== undefined && input.expectedCents !== fee.cents) fail(409, `The price is now ${formatEuro(fee.cents)}. Check it and book again.`);
    const firstFree = !!w?.firstFree;
    const credit = !w ? 0 : firstFree ? fee.cents : Math.min(w.creditCents, fee.cents);
    const b: Booking = {
      id: crypto.randomUUID(),
      bayId: bay.id,
      bay: { name: bay.name, real: bay.real, guard: bay.guard, class: bay.class },
      ownerId,
      kind: 'booking',
      status: 'booked',
      plate,
      extraPlate: null,
      vehicleLabel: input.vehicleLabel,
      createdAt: t,
      start,
      end,
      blocks,
      feeCents: fee.cents,
      demand: fee.demand,
      creditUsedCents: credit,
      firstFreeUsed: firstFree,
      creditGrantedCents: 0,
      blockedSince: null,
      blockedMs: 0,
      reminders: reminderTimes(t, start, end),
      sentReminders: [],
      charges: [],
      armed: false,
      ...(input.partner && { partner: input.partner }),
      ...(input.paymentIntentId && { paymentIntentId: input.paymentIntentId }),
    };
    addCharge(b, 'reservation', RECEIPT.fee(bay.class, fee.demand), fee.cents);
    if (credit) addCharge(b, 'credit', firstFree ? RECEIPT.firstFree() : RECEIPT.credit(), -credit);
    all.push(b);
    if (w && credit) {
      if (firstFree) w.firstFree = false;
      else w.creditCents -= credit;
    }
    const undo = () => {
      all.splice(all.indexOf(b), 1);
      if (w && credit) {
        if (firstFree) w.firstFree = true;
        else w.creditCents += credit;
        void persist(ownerId).catch(() => {});
      }
    };
    try {
      if (w && credit) await persist(ownerId);
    } catch (e) {
      undo();
      fail(502, `Your credit could not be updated, so nothing was booked: ${message(e)}`);
    }
    if (start - ARM_MS <= now()) {
      // a slot that starts within 10 min: the guard rises now
      try {
        await arm(b);
      } catch (e) {
        undo();
        fail(CAR_IN_BAY.test(message(e)) ? 409 : 502, `The bay could not be reserved: ${message(e)}`);
      }
    }
    note('booked', `${time(start)}–${time(end)}${credit ? (firstFree ? ', free first reservation' : ', credit used') : ''}`, bay.id);
    return view(b);
  }

  // The driver's own booking, or 404 (other drivers' bookings don't exist for them)
  const own = (ownerId: string, id: string) => {
    const b = all.find((x) => x.id === id);
    return b && b.ownerId === ownerId ? b : fail(404, 'Booking not found');
  };

  // ── Ending ──────────────────────────────────────────────────────────────────────────────────────
  function end(b: Booking, status: Status) {
    if (b.blockedSince !== null) b.blockedMs += now() - b.blockedSince;
    Object.assign(b, { status, endedAt: now(), plate: null, extraPlate: null, blockedSince: null, reroute: undefined, reminders: [] });
    const ended = all.filter((x) => !OPEN.includes(x.status));
    if (ended.length > HISTORY_CAP) all.splice(all.indexOf(ended[0]), 1);
    onEnd(b);
  }

  function chargeIdle(b: Booking) {
    const cents = idleFee(b.end, now());
    if (cents) addCharge(b, 'overstay', RECEIPT.idle(idleMinutes(b.end, now())), cents);
  }

  // Forget the booked plate on the camera's list once a booking that armed the bay is over (GDPR)
  function forgetPlates(b: Booking) {
    const lockId = bays.get(b.bayId)?.lockId;
    if (lockId && b.armed) void hw.setPlates(lockId, []).catch((e) => note('error', `camera plate list not cleared: ${message(e)}`, b.bayId));
  }

  // Cancelling: the fee by time before the start (free while the bay is blocked). The fee is paid with the
  // booking's credit first; what's left of the credit goes back to the wallet, and paid money back to the driver.
  // A free first reservation comes back only if cancelling was free.
  async function cancel(ownerId: string, id: string) {
    const b = own(ownerId, id);
    const w = await walletOf(ownerId);
    if (b.status !== 'booked') fail(409, IN_BAY.includes(b.status) ? 'You’ve checked in: the session ends when you finish or drive off' : 'This booking has already ended');
    const t = now();
    if (t > arriveBy(b)) fail(409, 'The arrival deadline has passed');
    const blocked = b.blockedSince !== null;
    const due = cancelCents(b.feeCents, { bookedAt: b.createdAt, start: b.start, at: t, blocked });
    let walletChanged = false;
    if (b.firstFreeUsed) {
      if (due === 0 && hasWallet(ownerId)) {
        w.firstFree = true;
        b.creditUsedCents = 0;
        walletChanged = true;
      }
    } else {
      const back = b.feeCents - due;
      if (back > 0) {
        const label = due ? RECEIPT.cancelRelease(due) : blocked ? RECEIPT.refundBlocked() : t - b.createdAt <= FREE_CANCEL_MS ? RECEIPT.refundEarly() : RECEIPT.refundAhead();
        addCharge(b, due ? 'released' : 'refund', label, -back);
      }
      const creditBack = b.creditUsedCents - Math.min(b.creditUsedCents, due);
      if (creditBack > 0) {
        addCharge(b, 'credit', 'Credit returned to your wallet', creditBack);
        b.creditUsedCents -= creditBack;
        if (hasWallet(ownerId)) {
          w.creditCents += creditBack;
          walletChanged = true;
        }
      }
    }
    end(b, 'cancelled');
    forgetPlates(b);
    note('cancelled', due ? `cancellation fee ${formatEuro(due)}` : 'free', b.bayId);
    if (walletChanged) void persist(ownerId).catch((e) => note('error', `credit not saved: ${message(e)}`, b.bayId));
    return view(b);
  }

  // ── At the bay ──────────────────────────────────────────────────────────────────────────────────
  async function lowerFor(b: Booking) {
    const lockId = bays.get(b.bayId)?.lockId;
    if (lockId) await hw.lower(lockId);
    site(b.bayId).loweredForSession = true;
  }

  async function checkIn(b: Booking, method: 'camera' | 'fallback', matchedBy?: 'exact' | 'fuzzy') {
    const st = site(b.bayId);
    b.status = 'arrived'; // before the await: a second camera read can't check in twice
    try {
      await lowerFor(b);
    } catch (e) {
      b.status = 'booked';
      fail(502, `Could not lower the arm: ${message(e)}`);
    }
    if (!bays.get(b.bayId)?.lockId && st.blocker) st.blocker = null; // the booked car is in, so whatever blocked it left
    if (b.blockedSince !== null) {
      b.blockedMs += now() - b.blockedSince;
      b.blockedSince = null;
      b.reroute = undefined;
    }
    Object.assign(b, { arrivedAt: now(), checkInMethod: method, ...(matchedBy && { matchedBy }) });
    note('checked_in', method === 'camera' ? (matchedBy === 'fuzzy' ? 'plate matched despite a misread, arm lowered' : 'plate matched, arm lowered') : 'driver checked in at the bay, arm lowered', b.bayId);
  }

  // Every car the camera sees arrive. An empty plate: it saw a car but couldn't read it.
  async function plateEvent(bayId: string, rawPlate: unknown) {
    const bay = bayOf(bayId);
    const st = site(bayId);
    const read = normalizePlate(rawPlate);
    st.seenAt = now();
    const b = liveOn(bayId);
    if (!b) {
      // nobody booked: on a simulated bay a car parking is ordinary use, so no alert, but the bay is taken.
      // Real bays go by their car sensor instead (syncHardware).
      if (!bay.lockId && !inBay(bayId) && !st.blocker) {
        st.blocker = { since: now() };
        note('bay_occupied', 'a car without a booking is in the bay', bayId);
      }
      return { matched: false };
    }
    if (!read) {
      b.unreadableAt = now();
      note('unreadable_plate', 'the camera saw a car but could not read the plate', bayId);
      return { matched: false };
    }
    const match = samePlate(read, b.plate) ?? samePlate(read, b.extraPlate);
    if (!match) {
      if (!bay.lockId && now() >= b.start - ARM_MS) block(b, read);
      else note('other_plate', 'a car without this booking’s plate was read', bayId);
      return { matched: false };
    }
    if (inBay(bayId)) {
      note('other_plate', 'the booked car arrived while the previous session is still in the bay', bayId);
      return { matched: false };
    }
    await checkIn(b, 'camera', match);
    return { matched: true, matchedBy: match };
  }

  // "I'm at the bay". On a hardware bay it needs the camera or the sensor to have just seen a car, as the
  // driver's reported location can be spoofed; a simulated bay has neither, so the 150 m geofence is enough.
  async function checkInManually(ownerId: string, id: string, pos: { lat?: unknown; lng?: unknown }) {
    const b = own(ownerId, id);
    if (!isLive(b)) fail(409, b.status === 'booked' ? 'Check in from 30 min before your start until the arrival deadline' : 'This booking isn’t waiting for you any more');
    const bay = bayOf(b.bayId);
    const st = site(b.bayId);
    if (st.blocker || st.occupied) fail(409, 'Another car is in the bay');
    if (bay.lockId && !evidence(b)) fail(409, 'The bay camera hasn’t seen your car yet. Drive up to the guard, or ask the operator.');
    const here = { lat: Number(pos?.lat), lng: Number(pos?.lng) };
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) fail(400, 'Your location is needed to check in');
    if (distanceM(bay, here) > GEOFENCE_M) fail(403, `Check in from the bay (within ${GEOFENCE_M} m)`);
    if (inBay(b.bayId)) fail(409, 'The previous driver is still in the bay');
    await checkIn(b, 'fallback');
    return view(b); // the coordinates are not kept
  }

  // Walk-up: a driver at a free bay unlocks it without booking, until the next booking's start − the gap
  async function unlock(ownerId: string, bayId: string, pos: { lat?: unknown; lng?: unknown }) {
    const bay = bayOf(bayId);
    const st = site(bayId);
    const t = now();
    if (bay.fault) fail(409, 'This charger is reported out of order');
    if (inBay(bayId)) fail(409, 'Someone is charging here right now');
    if (!bay.lockId && (st.blocker || st.occupied)) fail(409, 'Another car is in the bay');
    const o = open(bayId);
    if (o.some((b) => b.status === 'booked' && b.start - t < WALKUP_CLEAR_MS + MIN_GAP_MS)) fail(409, 'A booking starts here soon. Book a slot instead.');
    if (bay.lockId && t - st.seenAt > EVIDENCE_MS) fail(409, 'The bay camera hasn’t seen your car yet. Drive up to the guard first.');
    const here = { lat: Number(pos?.lat), lng: Number(pos?.lng) };
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) fail(400, 'Your location is needed to unlock the bay');
    if (distanceM(bay, here) > GEOFENCE_M) fail(403, `Unlock from the bay (within ${GEOFENCE_M} m)`);
    if (all.some((b) => b.ownerId === ownerId && IN_BAY.includes(b.status))) fail(409, 'You already have a session in progress');
    const next = o.find((b) => b.status === 'booked' && b.start > t);
    const until = Math.min(next ? next.start - MIN_GAP_MS : Infinity, blockStart(t) + CLASSES[bay.class].maxBlocks * BLOCK_MS);
    const b: Booking = {
      id: crypto.randomUUID(),
      bayId,
      bay: { name: bay.name, real: bay.real, guard: bay.guard, class: bay.class },
      ownerId,
      kind: 'walkup',
      status: 'arrived', // before the await: nobody else can unlock meanwhile
      plate: null,
      extraPlate: null,
      vehicleLabel: 'Walk-up',
      createdAt: t,
      start: t,
      end: until,
      blocks: Math.ceil((until - t) / BLOCK_MS),
      feeCents: 0,
      demand: priced(bay, t).demand,
      creditUsedCents: 0,
      firstFreeUsed: false,
      creditGrantedCents: 0,
      blockedSince: null,
      blockedMs: 0,
      arrivedAt: t,
      checkInMethod: 'walkup',
      reminders: reminderTimes(t, t, until),
      sentReminders: [],
      charges: [],
      armed: false,
    };
    all.push(b);
    try {
      await lowerFor(b);
    } catch (e) {
      all.splice(all.indexOf(b), 1);
      fail(502, `Could not lower the arm: ${message(e)}`);
    }
    st.blocker = null;
    note('walkup', `unlocked at the bay, free until ${time(until)}`, bayId);
    return view(b);
  }

  function startCharging(ownerId: string, id: string) {
    const b = own(ownerId, id);
    if (b.status !== 'arrived') fail(409, b.status === 'charging' ? 'Already charging' : 'Check in first');
    Object.assign(b, { status: 'charging', chargingAt: now() });
    note('charging', '', b.bayId);
    return view(b);
  }

  // The driver is done. The arm stays down until the car has left (vacated), so it can't rise under it.
  function finish(ownerId: string, id: string) {
    const b = own(ownerId, id);
    if (!IN_BAY.includes(b.status)) fail(409, 'This session isn’t in progress');
    chargeIdle(b);
    end(b, 'completed');
    note('completed', 'driver finished', b.bayId);
    return view(b);
  }

  // The bay is empty again (the car sensor, a camera "out", or the demo). Ends a session in progress, with any
  // idle fee, and clears a car without a booking. Once the car of a session has gone, the guard rises again.
  async function vacated(bayId: string) {
    const bay = bayOf(bayId);
    const st = site(bayId);
    const s = inBay(bayId);
    if (s) {
      chargeIdle(s);
      end(s, 'completed');
      note('completed', 'car left, bay is free', bayId);
    }
    st.occupied = false;
    if (st.blocker) unblock(bayId, bay.lockId ? 'sensor' : 'camera');
    if (st.loweredForSession && !inBay(bayId)) {
      st.loweredForSession = false;
      const armedFor = open(bayId).find((b) => b.status === 'booked' && b.armed);
      try {
        if (bay.lockId) await hw.raise(bay.lockId, armedFor ? plates(armedFor) : []);
        note('guarded', 'arm raised: the bay is guarded until the next session', bayId);
      } catch (e) {
        note('error', `the arm could not be raised after the car left: ${message(e)}`, bayId);
      }
    }
  }

  // "Different car today": a one-off second plate for this booking, or a switch to another registered car
  function setPlate(ownerId: string, id: string, change: { plate?: unknown; vehicle?: { plate: string; label: string } }) {
    const b = own(ownerId, id);
    if (b.status !== 'booked') fail(409, 'The car can be changed until you arrive');
    if (change.vehicle) {
      Object.assign(b, { plate: change.vehicle.plate, vehicleLabel: change.vehicle.label, extraPlate: null });
    } else {
      const p = normalizePlate(change.plate);
      if (p.length < 2 || p.length > 10) fail(400, 'Enter a valid license plate');
      b.extraPlate = p;
    }
    const lockId = bays.get(b.bayId)?.lockId;
    if (lockId && b.armed) void hw.setPlates(lockId, plates(b)).catch((e) => note('error', `camera plate list not updated: ${message(e)}`, b.bayId));
    note('other_plate', change.vehicle ? 'driver switched to another of their cars' : 'driver added a plate for today', b.bayId);
    return view(b);
  }

  // ── Blocked bays ────────────────────────────────────────────────────────────────────────────────
  function block(b: Booking, plate: string | null) {
    const bay = bays.get(b.bayId)!;
    const st = site(b.bayId);
    st.blocker ??= { since: now() };
    if (b.blockedSince !== null) return;
    b.blockedSince = now();
    grantCredit(b);
    note('bay_blocked', 'another car is in the booked bay: the arrival deadline waits, the driver gets a €5 credit', b.bayId);
    if (bay.real && !alerts.some((a) => a.bayId === bay.id && a.status === 'open')) {
      const alert: Alert = { id: crypto.randomUUID(), bayId: bay.id, since: now(), bookingId: b.id, plate, status: 'open', emailStatus: 'pending' };
      alerts.unshift(alert);
      alerts.length = Math.min(alerts.length, 150);
      onAlert(alert, bay);
    }
    void reroute(b);
  }

  // The nearest free bays for the same slot, for "Book instead"
  async function reroute(b: Booking) {
    const bay = bays.get(b.bayId)!;
    const found = await nearby(bay).catch(() => [] as BayInfo[]);
    const free = found
      .map(knowBay)
      .filter((c) => c.id !== bay.id && !c.fault && !site(c.id).blocker && !open(c.id).some((x) => clash(b.start, b.end, x.start, x.end)))
      .sort((x, y) => distanceM(bay, x) - distanceM(bay, y))
      .slice(0, 3);
    if (b.blockedSince !== null) b.reroute = free.map((c) => c.id);
  }

  function unblock(bayId: string, by: 'camera' | 'sensor' | 'operator') {
    const st = site(bayId);
    st.blocker = null;
    st.occupied = false;
    for (const b of open(bayId)) {
      if (b.blockedSince === null) continue;
      b.blockedMs += now() - b.blockedSince;
      b.blockedSince = null;
      b.reroute = undefined;
    }
    for (const a of alerts) if (a.bayId === bayId && a.status === 'open') Object.assign(a, { status: 'resolved', resolvedAt: now(), resolvedBy: by, plate: null });
    note('bay_clear', by === 'operator' ? 'an operator cleared the bay' : 'the other car left', bayId);
  }

  function resolveAlert(id: string) {
    const a = alerts.find((x) => x.id === id) ?? fail(404, 'Alert not found');
    if (a.status !== 'open') fail(409, 'This alert is already resolved');
    unblock(a.bayId, 'operator');
    return { ...a };
  }

  // ── The timer (every few seconds) ───────────────────────────────────────────────────────────────
  function sendDueReminders(b: Booking) {
    while (b.reminders.length && b.reminders[0].at <= now()) {
      const { key } = b.reminders.shift()!;
      const fits = BEFORE_START.includes(key) ? b.status === 'booked' : IN_BAY.includes(b.status);
      if (!fits) continue; // re-checked at send time: e.g. no "5 min to the start" once the car is in
      b.sentReminders.push({ key, at: now() });
      note('reminder', REMINDER_NOTES[key], b.bayId);
    }
  }

  function noShow(b: Booking) {
    end(b, 'no_show'); // the whole fee is kept; credit used stays used
    forgetPlates(b);
    note('no_show', 'arrival deadline passed, the bay is open for the next booking', b.bayId);
  }

  // Real locks: the car sensor decides whether a car without a booking is in the bay. A vacant reading clears
  // a stale "occupied" (a missed event, a reconnect); an occupied one with nobody checked in marks the bay taken,
  // and gives a live booking's driver the evidence for "I'm at the bay".
  async function syncHardware() {
    for (const bay of [...bays.values()].filter((b) => b.lockId)) {
      const st = site(bay.id);
      const s = await hw.status(bay.lockId!);
      st.hw = { online: s.online !== false, carPresence: s.carPresence ?? null, mock: s.mock };
      if (s.mock) continue; // the mock has no sensor
      if (s.carPresence === 'vacant' && st.blocker) unblock(bay.id, 'sensor');
      if (s.carPresence === 'occupied' && !inBay(bay.id)) {
        st.seenAt = now();
        const live = liveOn(bay.id);
        if (live) live.presenceAt = now();
        else if (!st.blocker) {
          st.blocker = { since: now() };
          note('bay_occupied', 'a car without a booking is in the bay', bay.id);
        }
      }
    }
  }

  async function tick() {
    if (ticking) return; // a slow hardware call must not stack ticks
    ticking = true;
    try {
      await syncHardware();
      for (const b of all.filter((x) => OPEN.includes(x.status))) {
        sendDueReminders(b);
        if (b.status !== 'booked') continue;
        const st = site(b.bayId);
        if (b.blockedSince === null && now() > arriveBy(b)) {
          noShow(b);
          continue;
        }
        if (now() < b.start - ARM_MS || b.armed) continue;
        // from start − 10 min: a car already in the bay blocks it; otherwise the guard rises
        if (!bays.get(b.bayId)?.lockId && (st.occupied || st.blocker || inBay(b.bayId))) {
          block(b, null);
          continue;
        }
        if (b.blockedSince !== null || now() - (b.armTriedAt ?? 0) < ARM_RETRY_MS) continue;
        try {
          await arm(b);
          note('guarded', 'arm raised for the next booking', b.bayId);
        } catch (e) {
          if (CAR_IN_BAY.test(message(e))) block(b, null);
          else note('error', `the arm could not be raised for the next booking, retrying: ${message(e)}`, b.bayId);
        }
      }
    } finally {
      ticking = false;
    }
  }

  // ── The demo (simulated bays only; the routes refuse bays with a real lock) ──────────────────────
  async function setOccupied(bayId: string, occupied: boolean) {
    bayOf(bayId);
    const st = site(bayId);
    if (!occupied) return vacated(bayId);
    st.occupied = true;
    st.seenAt = now();
    if (inBay(bayId)) return; // that's the session's own car
    if (!st.blocker) {
      st.blocker = { since: now() };
      note('bay_occupied', 'a car without a booking is in the bay', bayId);
    }
    for (const b of open(bayId)) if (b.status === 'booked' && now() >= b.start - ARM_MS) block(b, null);
  }

  function setDemand(level: DemandLevel | null) {
    demand = level;
    note('demand', level ? `site demand set to ${level}` : 'site demand back to the time of day');
  }

  // ── Reading ─────────────────────────────────────────────────────────────────────────────────────
  function availability(viewerId: string | null, bayId: string, date: string): Availability {
    const info = bayOf(bayId);
    const starts = dayBlocks(date);
    if (!starts.length) fail(400, 'date must be a day as YYYY-MM-DD');
    const t = now();
    const o = open(bayId);
    const first = earliestStart(t);
    const blocks = starts.map((start): { start: number; state: BlockState } => {
      const hit = o.find((b) => start < b.end && b.start < start + BLOCK_MS);
      if (hit) return { start, state: viewerId && hit.ownerId === viewerId ? 'mine' : 'booked' };
      if (start < first || start - t > HORIZON_MS) return { start, state: 'past' };
      return { start, state: o.some((b) => clash(start, start + BLOCK_MS, b.start, b.end)) ? 'gap' : 'free' };
    });
    return { bayId, date, blocks, maxBlocks: CLASSES[info.class].maxBlocks, class: info.class };
  }

  async function bookingsOf(ownerId: string): Promise<BookingsResponse> {
    const w = await walletOf(ownerId);
    const mine = all.filter((b) => b.ownerId === ownerId);
    const active = mine.find((b) => IN_BAY.includes(b.status));
    return {
      upcoming: mine.filter((b) => b.status === 'booked').sort((a, b) => a.start - b.start).map(view),
      active: active ? view(active) : null,
      past: mine
        .filter((b) => !OPEN.includes(b.status))
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 50)
        .map(view),
      creditCents: w.creditCents,
      firstFree: w.firstFree,
    };
  }

  const get = (ownerId: string, id: string) => view(own(ownerId, id));

  // The operator's view of a bay: never drivers' identities; plates only on open alerts
  function operatorBay(bayId: string) {
    const info = bayOf(bayId);
    const st = site(bayId);
    const b = inBay(bayId) ?? liveOn(bayId) ?? open(bayId).find((x) => x.status === 'booked');
    return {
      bay: bayView(info),
      lockId: info.lockId ?? null,
      hardware: st.hw ?? null,
      blockedSince: st.blocker?.since ?? null,
      booking: b ? { status: phase(b), start: b.start, end: b.end, arriveBy: arriveBy(b), blockedSince: b.blockedSince, kind: b.kind } : null,
    };
  }

  // Raw records for the operator's statistics. Server-only: never send these to a browser as they are.
  const analytics = () => ({ records: [...all], alerts: [...alerts] });

  // "Simulate a week" (demo only): replaces any earlier simulated data instead of piling it up
  function setSimulated(records: Booking[], extra: Alert[]) {
    for (let i = all.length - 1; i >= 0; i--) if (all[i].simulated) all.splice(i, 1);
    all.push(...records);
    for (let i = alerts.length - 1; i >= 0; i--) if (alerts[i].simulated) alerts.splice(i, 1);
    alerts.push(...extra);
    alerts.sort((a, b) => b.since - a.since);
    note('simulated', `${records.length} simulated bookings added for the past week`);
  }

  return {
    // bays
    bay: (id: string) => bays.get(id) ?? null,
    bays: () => [...bays.values()],
    realBays: () => [...bays.values()].filter((b) => b.real),
    knowBay,
    dropLocks,
    bayView,
    availability,
    // driver
    quoteSlot,
    quoteNow,
    reserve,
    get,
    bookingsOf,
    cancel,
    checkInManually,
    startCharging,
    finish,
    unlock,
    setPlate,
    wallet: walletOf,
    // the bay's camera and sensor
    plateEvent,
    vacated,
    held: (bayId: string) => !!liveOn(bayId),
    carSeen: (bayId: string) => void (site(bayId).seenAt = now()), // a plate read in front of a raised arm
    // timer, demo and operator
    tick,
    setOccupied,
    setDemand,
    demand: () => demand,
    resolveAlert,
    alerts: () => alerts.map((a) => ({ ...a })),
    log: () => log,
    note,
    operatorBay,
    analytics,
    setSimulated,
    // the old screens (legacy.ts): the booking a driver is in, or about to be
    current: (ownerId: string) => {
      const mine = all.filter((b) => b.ownerId === ownerId);
      const b =
        mine.find((x) => IN_BAY.includes(x.status)) ??
        mine.find((x) => isLive(x)) ??
        mine.filter((x) => !OPEN.includes(x.status) && now() - (x.endedAt ?? 0) < 30 * 60_000).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))[0];
      return b ? { booking: b, view: view(b) } : null;
    },
    onBay: (bayId: string) => {
      const b = inBay(bayId) ?? liveOn(bayId);
      return b ? { booking: b, view: view(b) } : null;
    },
  };
}
export type Schedule = ReturnType<typeof createSchedule>;
