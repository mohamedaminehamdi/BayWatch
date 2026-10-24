// Booking v2: the shared contract between the engine and API (lib/, app/api/) and everything built on them
// (UI, voice, payments, partners). Spec: scratchpad/booking-v2-spec.md §8. Types only, no runtime code.
// Times are epoch ms, money is integer euro cents. Keep it stable: tell "main" before changing anything here.

export type BayClass = 'slow' | 'fast' | 'ultra'; // < 50 kW (4 h max) · 50–299 kW (2 h) · ≥ 300 kW (1 h)
export type Guard = 'hardware' | 'simulated'; // a real lock (arm, sensor, camera), or the same states kept in memory
export type BayStatus = 'free' | 'reserved' | 'occupied' | 'offline';
export type Led = 'green' | 'red'; // green: a driver at the bay can unlock it now (walk-up)
export type DemandLabel = 'Quiet' | 'Normal' | 'Busy' | 'Peak'; // ×0.8 · ×1 · ×1.5 · ×2 (Peak: demo override only)
export type DemandLevel = 'quiet' | 'normal' | 'busy' | 'full'; // the demo's "Site demand" override

export type ChargePoint = { type: string; power: number; count: number }; // as GoingElectric lists them (kW)

export interface Bay {
  id: string; // 'bw-1' … 'bw-3' (the Baywatch bays) or 'ge-<ge_id>' (GoingElectric, simulated guard)
  name: string;
  lat: number;
  lng: number;
  address: string;
  network?: string;
  url?: string; // the charger's GoingElectric page
  points: ChargePoint[];
  powerKw: number; // the highest power at the bay
  class: BayClass;
  real: boolean; // true for the three Baywatch bays
  guard: Guard; // a Baywatch bay with guard 'simulated' has no lock yet: "No hardware assigned yet" (bw-3)
  status: BayStatus; // now. reserved: a booking is live (from start − 30 min until the car arrives);
  //                    occupied: a car is in the bay (a session, or a car without a booking); offline: hardware
  //                    offline, or GoingElectric reports a fault
  led: Led;
  nextBookingAt?: number; // start of the next booking that hasn't started yet, within the 60-day horizon
  priceFromCents: number; // the lowest reservation fee for this bay (quiet demand, or the demo override)
}

export type BlockState = 'free' | 'booked' | 'gap' | 'past' | 'mine'; // gap: free, but too close to a booking
export interface Block {
  start: number; // on the 15-min grid, Europe/Berlin
  state: BlockState;
}
export interface Availability {
  bayId: string;
  date: string; // YYYY-MM-DD, Europe/Berlin
  blocks: Block[]; // 96 for a normal day; 92 or 100 on the two daylight-saving days
  maxBlocks: number; // the longest booking on this bay's class: 16, 8 or 4
  class: BayClass;
}

// From `from` on, cancelling costs `cents` (`percent` of the fee). Sorted by time; the last step lasts until the
// arrival deadline, after which the booking is a no-show (100%).
export interface CancelStep {
  from: number;
  cents: number;
  percent: number;
}

export interface Quote {
  bayId: string;
  start: number;
  end: number;
  blocks: number;
  class: BayClass;
  cents: number; // the reservation fee, fixed once booked
  demand: DemandLabel;
  multiplier: number; // class × demand
  creditAppliedCents: number; // taken from the driver's credit, or the whole fee on a free first reservation
  payCents: number; // cents − creditAppliedCents: what "Pay … and reserve" charges
  noShowCents: number; // 100% of the fee
  cancelSchedule: CancelStep[]; // as if booked now
  valid: boolean;
  reason?: string; // why not valid: off the grid, too long, too far ahead, overlaps, the 3-booking limit …
}

export type ReservationStatus =
  | 'upcoming' // booked, more than 30 min before the start
  | 'live' // from start − 30 min until the car arrives (or the arrival deadline: start + 15 min)
  | 'arrived' // checked in, the guard is down
  | 'charging'
  | 'walkup' // unlocked at the bay without a booking, until the next booking's start − gap
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type ChargeKind =
  | 'reservation' // + the fee
  | 'credit' // − credit used ("Credit used −€X"), or the free first reservation
  | 'refund' // − a full refund (cancelled in the free window, or while the bay was blocked)
  | 'released' // − returned, less the cancellation fee
  | 'overstay'; // + idle time after the 5 free minutes
export interface Charge {
  kind: ChargeKind;
  label: string;
  cents: number;
  at: number;
}

// Reminders, in order: start − 24 h (only if booked more than a day ahead), start − 30 min (the booking goes
// live), start − 5 min, end − 5 min, the end (5 free minutes start), end + 5 min (the idle fee starts)
export type ReminderKey = 'day_before' | 'live' | 'five_before' | 'five_left' | 'slot_over' | 'idle_fee';

// One booking, as its owner sees it (other drivers only ever see blocks as 'booked'). Never holds a full plate.
export interface ReservationView {
  id: string;
  bayId: string;
  bayName: string;
  real: boolean;
  guard: Guard;
  class: BayClass;
  start: number;
  end: number; // a walk-up ends at the next booking's start − the gap
  blocks: number;
  status: ReservationStatus;
  arriveBy: number; // start + 15 min, plus any time the bay was blocked
  feeCents: number;
  demand: DemandLabel;
  charges: Charge[]; // the receipt
  totalCents: number; // what the driver has paid in money so far, refunds included
  creditUsedCents: number;
  creditGrantedCents: number; // the €5 credit for a blocked bay, once per booking
  cancelNowCents: number | null; // what cancelling right now costs; null once it can't be cancelled
  cancelSchedule: CancelStep[];
  createdAt: number;
  blockedSince?: number; // another car is in the bay: cancelling is free, and the arrival deadline waits
  reroute?: { alternatives: Bay[] }; // nearest free bays while this one is blocked: "Book instead" / "Navigate"
  carAtBay?: boolean; // the bay has just seen a car: the fallback check-in ("I'm at the bay") is open
  plateHint?: string; // masked, e.g. 'MA•••34'
  extraPlateHint?: string; // "different car today": a one-off second plate for this booking, masked
  vehicleLabel?: string;
  arrivedAt?: number;
  chargingAt?: number;
  endedAt?: number;
  checkInMethod?: 'camera' | 'fallback' | 'walkup';
  matchedBy?: 'exact' | 'fuzzy';
  sentReminders: { key: ReminderKey; at: number }[];
  bookedVia?: string; // the partner app's name, for partner bookings
}

export interface Wallet {
  creditCents: number;
  firstFree: boolean; // the next reservation fee is on us
}

// ── API bodies and responses (spec §8) ──────────────────────────────────────────────────────────────
export interface BaysResponse {
  bays: Bay[]; // in the box, GoingElectric and real
  realBays: Bay[]; // the three Baywatch bays, always, whatever the box
}
export interface BayDetail extends Bay {
  today: Availability;
}
export interface BookingsResponse extends Wallet {
  upcoming: ReservationView[]; // soonest first; includes 'live'
  active: ReservationView | null; // arrived, charging or walk-up
  past: ReservationView[]; // newest first
}
export interface ReserveRequest {
  bayId: string;
  start?: number; // both unused with `now`
  blocks?: number;
  now?: true; // "Book now": this moment, from the block under way for at least an hour (the server sets the slot)
  vehicleId: string;
  priceCents: number; // Quote.cents the driver saw: a different price now is a 409
  acceptFees: true;
  payment: 'demo';
}
export interface UnlockRequest {
  lat: number;
  lng: number;
}
// GET /api/state: what the app shell needs on every screen (polled every 2 s)
export interface ViewerSummary extends Wallet {
  active: ReservationView | null; // arrived, charging or walk-up
  next: ReservationView | null; // the soonest upcoming or live booking
}
export interface StateResponse {
  simulator: boolean;
  demand: DemandLevel | null; // the demo "Site demand" override, if set
  viewer: ViewerSummary | null; // null when signed out
  realBays: Bay[];
}
export type ApiError = { error: string };
