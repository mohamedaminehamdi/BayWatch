// Live camera and car-sensor events from the Ecurious server → the reservation engine. instrumentation.ts
// starts it once per server process, in live hardware mode only. Events for other bays are ignored.
//   plate read         → plateEvent(plate, 'in'): checks the booked car in (the engine then lowers the arm)
//                        or flags another car. In an unbooked bay it waits until a car really pulls in, so a
//                        car driving past doesn't mark the bay as taken.
//   sensor: occupied   → plateEvent(<plate read in the last 2 min, or '' = unreadable>, 'in')
//   sensor: vacant     → still vacant after ECURIOUS_VACANT_MS: plateEvent(<checked-in plate>, 'out'), "car left"
// Plates stay in memory only, never in a log.
import * as hw from './ecurious.ts';
import { connectEvents, toEvent, type HwEvent } from './ecurious-events.ts';
import type { createReservations } from './reservation.ts';

type Engine = Pick<ReturnType<typeof createReservations>, 'plateEvent' | 'state'>;

const FRESH_MS = 2 * 60_000; // a plate read counts for the car that pulls in within 2 min
// the sensor's debounce: a car only "left" once the bay stayed empty this long (a calibration knob)
const VACANT_MS = Number(process.env.ECURIOUS_VACANT_MS ?? 10_000);

export function createBridge(
  engine: Engine,
  { lockId, presence, vacantMs = VACANT_MS, now = Date.now }: { lockId: string; presence?: string | null; vacantMs?: number; now?: () => number },
) {
  let seen: { plate: string; at: number } | null = null; // the last plate read
  let checkedIn: string | null = null; // the booked car's plate, once the camera checked it in
  let leaving: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // one event at a time, in order: plateEvent waits for the arm
  const run = (fn: () => Promise<unknown>) =>
    (queue = queue.then(fn).catch((e) => console.error(`[ecurious] event not applied: ${(e as Error).message}`)));
  const arrive = (plate: string) =>
    run(async () => {
      if ((await engine.plateEvent(plate, 'in')).matched) checkedIn = plate;
    });

  function handle(e: HwEvent) {
    if (e.lockId !== lockId) return queue;
    if (e.type === 'photo') {
      seen = { plate: e.plate, at: now() };
      // a held bay: decide now, the arm is up and the car can't pull in before check-in
      if (presence === 'occupied' || engine.state(null).reservation?.status === 'reserved') return arrive(e.plate);
    } else if (e.type === 'presence') {
      const was = presence;
      presence = e.presence;
      clearTimeout(leaving);
      if (e.presence === 'occupied' && was !== 'occupied') return arrive(seen && now() - seen.at <= FRESH_MS ? seen.plate : '');
      if (e.presence === 'vacant' && was === 'occupied') {
        leaving = setTimeout(
          () =>
            run(async () => {
              const plate = checkedIn ?? '';
              checkedIn = seen = null;
              await engine.plateEvent(plate, 'out');
            }),
          vacantMs,
        );
      }
    }
    return queue;
  }

  return { handle, stop: () => clearTimeout(leaving) };
}

// One bridge per process. A dev reload runs register() again: the old bridge is stopped, never doubled.
const g = globalThis as typeof globalThis & { ecurious_bridge_v1?: () => void };

export function startBridge() {
  if (!hw.live()) return;
  g.ecurious_bridge_v1?.();
  let stopped = false;
  let stop = () => {};
  g.ecurious_bridge_v1 = () => {
    stopped = true;
    stop();
  };
  if (process.env.SIMULATOR === '1') console.warn('[ecurious] SIMULATOR=1 with live hardware: a faked plate moves the real arm');

  void (async () => {
    // the engine singleton the route handlers use: it lives on globalThis (server.ts)
    const { reservations } = await import('./server');
    let lockId = '';
    for (let delay = 2_000; !lockId; delay = Math.min(delay * 2, 60_000)) {
      try {
        lockId = await hw.lockId();
      } catch (e) {
        console.warn(`[ecurious] bay not resolved (${(e as Error).message}), retrying in ${delay / 1000} s`);
        await new Promise((r) => setTimeout(r, delay));
      }
      if (stopped) return;
    }
    const bridge = createBridge(reservations, { lockId, presence: (await hw.status()).carPresence });
    const unknown = new Set<string>();
    const conn = connectEvents({
      open: hw.openEvents,
      onMessage: (m) => {
        const e = toEvent(m);
        if (e) {
          hw.noteEvent(e);
          void bridge.handle(e);
        } else if (m.event !== 'connected' && !unknown.has(m.event)) {
          unknown.add(m.event);
          console.info(`[ecurious] event not handled: ${m.event}`); // the name only: the payload may hold a plate
        }
      },
      onState: (up, why) => {
        hw.noteStream(up);
        if (up) console.info(`[ecurious] live events connected, bay ${lockId}`);
        else console.warn(`[ecurious] live events down (${why}), reconnecting`);
      },
    });
    stop = () => {
      conn.stop();
      bridge.stop();
    };
    if (stopped) stop();
  })().catch((e) => console.error(`[ecurious] bridge not started: ${(e as Error).message}`));
}
