// Live camera and car-sensor events from the Ecurious server → the booking engine (schedule.ts), one bridge per
// Baywatch bay with a lock. instrumentation.ts starts them once per server process, in live hardware mode only.
// Events for other locks are ignored.
//   plate read         → carSeen(bay) (walk-up evidence), and plateEvent(bay, plate) when a booking is live or a car
//                        is already on the sensor: checks the booked car in (the engine lowers the arm). In a bay
//                        with nothing booked it waits until a car really pulls in, so a car driving past is ignored.
//   sensor: occupied   → plateEvent(bay, <plate read in the last 2 min, or '' = unreadable>)
//   sensor: vacant     → still vacant after ECURIOUS_VACANT_MS: vacated(bay), "car left" (no plate needed)
// Plates stay in memory only, never in a log.
import * as hw from './ecurious.ts';
import { connectEvents, toEvent, type HwEvent } from './ecurious-events.ts';

// the part of the booking engine the bridge drives
type Engine = {
  plateEvent(bayId: string, plate: unknown): Promise<{ matched: boolean }>;
  vacated(bayId: string): unknown;
  held(bayId: string): boolean;
  carSeen(bayId: string): void;
};

const FRESH_MS = 2 * 60_000; // a plate read counts for the car that pulls in within 2 min
// the sensor's debounce: a car only "left" once the bay stayed empty this long (a calibration knob)
const VACANT_MS = Number(process.env.ECURIOUS_VACANT_MS ?? 10_000);

export function createBridge(
  engine: Engine,
  {
    bayId,
    lockId,
    presence,
    vacantMs = VACANT_MS,
    now = Date.now,
  }: { bayId: string; lockId: string; presence?: string | null; vacantMs?: number; now?: () => number },
) {
  let seen: { plate: string; at: number } | null = null; // the last plate read
  let leaving: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // one event at a time, in order: plateEvent waits for the arm
  const run = (fn: () => Promise<unknown> | unknown) =>
    (queue = queue.then(fn).catch((e) => console.error(`[ecurious] event not applied: ${(e as Error).message}`)));
  const arrive = (plate: string) => run(() => engine.plateEvent(bayId, plate));

  function handle(e: HwEvent) {
    if (e.lockId !== lockId) return queue;
    if (e.type === 'photo') {
      seen = { plate: e.plate, at: now() };
      engine.carSeen(bayId);
      // a held bay: decide now, the arm is up and the car can't pull in before check-in
      if (presence === 'occupied' || engine.held(bayId)) return arrive(e.plate);
    } else if (e.type === 'presence') {
      const was = presence;
      presence = e.presence;
      if (e.presence === 'occupied') {
        clearTimeout(leaving); // the "vacant" was a flicker: the car is still there
        if (was !== 'occupied') return arrive(seen && now() - seen.at <= FRESH_MS ? seen.plate : '');
      } else if (was === 'occupied') {
        const since = now();
        leaving = setTimeout(
          () =>
            run(() => {
              if (seen && seen.at <= since) seen = null; // a read after the car left belongs to the next car
              return engine.vacated(bayId);
            }),
          vacantMs,
        );
      }
    }
    return queue;
  }

  return { handle, stop: () => clearTimeout(leaving) };
}

// One stream for all locks, one bridge per bay. A dev reload runs register() again: the old bridges are stopped,
// never doubled.
const g = globalThis as typeof globalThis & { ecurious_bridge_v2?: () => void };

export function startBridge() {
  if (!hw.live()) return;
  g.ecurious_bridge_v2?.();
  let stopped = false;
  let stop = () => {};
  g.ecurious_bridge_v2 = () => {
    stopped = true;
    stop();
  };

  void (async () => {
    // the engine singleton the route handlers use: it lives on globalThis (server.ts)
    const { schedule, validateLocks } = await import('./server');
    for (let delay = 2_000; !(await validateLocks()); delay = Math.min(delay * 2, 60_000)) {
      console.warn(`[ecurious] the team's locks could not be read, retrying in ${delay / 1000} s`);
      await new Promise((r) => setTimeout(r, delay));
      if (stopped) return;
    }
    const bays = schedule.realBays().filter((b) => b.lockId);
    const bridges = await Promise.all(
      bays.map(async (b) => createBridge(schedule, { bayId: b.id, lockId: b.lockId!, presence: (await hw.status(b.lockId)).carPresence })),
    );
    const unknown = new Set<string>();
    const conn = connectEvents({
      open: hw.openEvents,
      onMessage: (m) => {
        const e = toEvent(m);
        if (e) {
          hw.noteEvent(e);
          for (const b of bridges) void b.handle(e);
        } else if (m.event !== 'connected' && !unknown.has(m.event)) {
          unknown.add(m.event);
          console.info(`[ecurious] event not handled: ${m.event}`); // the name only: the payload may hold a plate
        }
      },
      onState: (up, why) => {
        hw.noteStream(up);
        if (up) console.info(`[ecurious] live events connected, bays ${bays.map((b) => `${b.id} (${b.lockId})`).join(', ')}`);
        else console.warn(`[ecurious] live events down (${why}), reconnecting`);
      },
    });
    stop = () => {
      conn.stop();
      for (const b of bridges) b.stop();
    };
    if (stopped) stop();
  })().catch((e) => console.error(`[ecurious] bridge not started: ${(e as Error).message}`));
}
