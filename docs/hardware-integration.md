# Hardware integration: the Ecurious bay

_Last updated: 2026-10-24 (booking v2). **Verified live (read-only):** the lock list, lock details, the latest plate and the event stream, through our own client; the user tested the camera's plate list directly and it works. **Still to verify at the bay (phase 2):** every command that moves the arm, and auto-lift. The app runs on the mock unless `ECURIOUS_LIVE=1` is set._

## In short

- **Three Baywatch bays, two locks.** Each Baywatch bay is one Chang Cheng CC5S ground lock (a barrier arm with a car sensor and a plate camera) behind the Ecurious server: `bw-1 → lock-0002`, `bw-2 → lock-0003`, and `bw-3` has no lock yet (a simulated guard, "No hardware assigned yet"). `lock-0001` isn't the team's any more and is never called. We reach the server with REST calls and a live event stream (Server-Sent Events); the key goes in an `X-API-Key` header for both, so it never appears in a URL.
- **The arm is up between sessions** (the bay is guarded). It goes **up** for a booking when the slot is about to start: at booking time for a slot starting within 10 min, otherwise at start − 10 min. A refused raise (a car over the arm, an offline lock) undoes a booking made for "now", with that reason. It goes **down** when the booked car is recognised, or for a walk-up, and **up again** once that session's car has left.
- **The camera's plate list is on by default.** When the arm goes up for a booking, the booked plate (and a "different car today" plate) goes on the camera's own list, so the camera lowers the arm for that car by itself. If the camera doesn't echo the plate back, the app's own plate match lowers it. The list is emptied at check-in, cancel, no-show and the end of the session. `ECURIOUS_WHITELIST=0` turns it off. We never send `wildcard`.
- **Camera and sensor events** reach the booking engine (`lib/schedule.ts`) through one bridge per lock that `instrumentation.ts` starts:
  - every plate read becomes `carSeen(bay, plate)` (walk-up evidence), and `plateEvent(bay, plate)` while a booking is live;
  - the car sensor going vacant for 10 s becomes `vacated(bay)`: the session ends, and the arm rises again.
- **The docs and the server disagree.** Event names carry a `lock:` prefix, presence events are called `car_presence`, a third `status` value (`offline`) exists, and the whitelist has two contradictory specs. Details are [below](#what-the-docs-say-and-what-the-server-does).

## The service

- **Base URL:** `https://parking-lock-service-production.up.railway.app`. The docs page is at `/`, the REST API under `/api/v1`, and the events at `/api/v1/events` (also `/events`).
- **Auth:** the team key, as an `X-API-Key` header (what we use) or an `apiKey` query parameter (what the docs' examples and the vendor dashboard use). The header works for the event stream too.
- **Our team** is "Baywatch", with three camera bays: `lock-0001`, `lock-0002` and `lock-0003` (serials `6688202620000001`, `…02` and `…03`). The fair-play rule: we only touch bays that `GET /api/v1/locks` returns for our key, and the adapter refuses any other `ECURIOUS_LOCK_ID`.

| Call | Use | What we saw |
|---|---|---|
| `GET /api/v1/locks` | Our bays, and the default bay | 200 in about 80 ms: `{team, locks[], assignedLocks[]}`, the same list twice. Without a key: 401 `{"error":"Missing API key. Provide via ?apiKey=... or X-API-Key header."}` |
| `GET /api/v1/locks/:id` | Status, read at most every 5 s | 200 in 75–130 ms: `{lock: {…}}` |
| `GET /api/v1/locks/:id/plate/latest` | Not used by the app (the event stream carries the reads) | `{lockId, timestamp, licensePlate, plateType}`. A bay with no reads gets 404 `{"error":"No license plates have been recognized yet for lock 'lock-0002'."}` |
| `POST /api/v1/locks/:id/lock` `{cancelAutoLift: true}` | **Reserve:** raise the arm | Phase 2 |
| `POST /api/v1/locks/:id/unlock` `{cancelAutoLift: true}` | **Check-in, cancel, no-show:** lower the arm and keep it down | Phase 2 |
| `POST /api/v1/locks/:id/whitelist` `{plates: [...]}` | The camera's plate list during a hold: `[]`, or the booked plate | Phase 2 |
| `POST /api/v1/locks/:id/keep-state` | Not used in the flow; only as a manual recovery step | Phase 2 |
| `GET /api/v1/events` (SSE) | Plate reads, car sensor, arm movements, alarms | See [events](#the-live-events) |

### What a bay looks like (`lock-0002`, 2026-10-24 11:22 UTC)

```json
{
  "id": "lock-0002", "name": "Lock 0002", "serialHex": "6688202620000002", "hasCamera": true,
  "status": "raised", "carPresence": "vacant", "deviceStatusRaw": 1, "carPresenceRaw": 2,
  "battery12V": 15, "battery3_7V": 0, "signalStrength4G": 0, "waterIngress": false,
  "activeErrors": [], "lastSeenAt": "2026-10-24T11:20:57.105Z", "whitelist": ["*"]
}
```

`lock-0001` also had `"latestPhoto": {"timestamp": "2026-10-24T09:58:00.896Z", "licensePlate": "京A•••01", "plateType": "0"}`. That's a 7-character Chinese-format plate, masked here, read before we started.

### The live events

These came from two listens of 2 minutes each, with nothing moving at the bay:

```
event: connected
data: {"status":"connected","timestamp":"2026-10-24T10:56:22.468Z"}

: keepalive                     ← a comment every 20 s

event: lock:heartbeat           ← every 3 min per online bay (02 at :57, 03 at :25, 01 at :59)
data: {"type":"lock:heartbeat","lockId":"lock-0002","battery12V":15}
```

- No `id:` lines, so a reconnect can't resume. Events missed while disconnected are gone, which is why `status()` also reads over REST.
- The movement, sensor, plate and alarm events didn't occur, because nothing moved. Their real names come from the vendor dashboard's own code, which listens for `lock:status_change` (`data.status`), `lock:car_presence` (`data.presence`) and `lock:photo_captured`.
- Our parser accepts both these names and the documented ones, plus the raw device codes (1 and 2).

## What the docs say and what the server does

| Topic | Docs | Real |
|---|---|---|
| Event names | `status_change`, `vehicle_presence`, `photo_captured`, `alarm` | Prefixed: `lock:heartbeat` (seen). The vendor dashboard listens for `lock:status_change`, **`lock:car_presence`** and `lock:photo_captured`. Plus a `connected` event, and a heartbeat that isn't documented. **The live server sends `lock:status_changed`** (`status`, `rawStatus`) **and `lock:car_presence_changed`** (`carPresence`, `carPresenceRaw`), seen 24 Oct from 16:00, plus `lock:connected` and `lock:disconnected` when a lock comes and goes (17:14). The parser takes all of them |
| `status` | `"raised"` or `"lowered"` | Also **`"offline"`**: `lock-0001` was offline from 10:29 (last seen) until at least 10:58, and back to `"raised"` by 11:20. `deviceStatusRaw` keeps the last position (1 raised, 2 lowered). Also **`"moving"`** while the arm travels: `lock-0001` reported it for over 30 s (24 Oct, 17:12–17:13), then `"raised"`, then went offline at 17:14 |
| Lock fields | 12 fields | Also `deviceStatusRaw`, `carPresenceRaw` (2 = vacant), `whitelist`, and `latestPhoto` on a bay with a read |
| The list response | `{team, locks}` | `{team, locks, assignedLocks}`, with the same list twice |
| `plateType` | `"standard"` | `"0"` |
| `battery3_7V`, `signalStrength4G` | Example values 3.9 and 28 | **0 on every bay**. `battery12V` is 15.0–15.1 V, above a 12 V battery's level, so the units are probably on mains power |
| `/whitelist`, spec 1 | `{plates: ["MBD14E","B12345"]}` stores both; `{wildcard: true}` means any car; `{plates: []}` disables auto-lowering | The vendor dashboard sends exactly these three bodies |
| `/whitelist`, spec 2 (same endpoint, documented twice) | "Up to 10 plates"; the request `["吉MBD14E","粤B88888","MBD14E"]` answers "uploaded **2** … rule(s)" and stores only the two plates **with a Chinese province prefix** | A plate **without** a prefix (`A613EN`) was stored and echoed on `lock-0003` (24 Oct, 17:10), and the camera then lowered the arm by itself, with no command from us, when shown `湘A 613-EN`. The adapter still checks the echo and warns if a plate is missing. The list is on by default (`ECURIOUS_WHITELIST=0` turns it off) |
| The default list | Not stated | **`["*"]` on all three bays:** any car lowers the arm. The vendor dashboard also shows a missing list as "ANY PLATE" |
| `cancelAutoLift` | "If true, disables auto-relift timeout", on unlock (and accepted on lock) | The vendor dashboard sends `{cancelAutoLift: true}` on **lock** and `{}` on unlock. The timeout's length and trigger are unverified (phase 2, step 4) |
| Auth in examples | `?apiKey=` everywhere | The `X-API-Key` header works for REST and for the event stream |
| The list after a write | Stays as set | **Read back different three times** on `lock-0003` (24 Oct, 17:10–17:16), 15 s to 1.5 min after we set it or after the arm moved. Once it was `["*"]` (any car) again, 34 s after we set the booked plate. The app reads the list back and sends it again, at most every 30 s (`keepList` in `schedule.ts`), so during that gap any car could lower the arm |

## How the app maps onto the hardware

The engine ([schedule.ts](../web/lib/schedule.ts)) calls the adapter ([ecurious.ts](../web/lib/ecurious.ts)) with the lock of the bay, every time: `raise(lockId, plates)`, `lower(lockId)`, `setPlates(lockId, plates)`, `status(lockId)`. A call without a lock reads `ECURIOUS_LOCK_ID` and never guesses, and every call first checks the lock is in the team's list.

| App moment | Hardware calls | Why |
| --- | --- | --- |
| **The slot starts** (at booking for "now", else start − 10 min): `raise` | A fresh `GET` of the lock → `POST lock {cancelAutoLift: true}` (skipped if it's already up) → `POST whitelist {plates: [booked plate, today's plate]}` | **The read:** we never raise the arm onto a car (`carPresence` must be `vacant`) or on an `offline` lock. For a "now" booking either refusal undoes the booking with its reason; for a later slot a car over the arm marks the booking blocked (the €5 credit, re-routing, the operator alert). **The plate list:** the camera lowers the arm for the booked car by itself; the echoed list says whether it took the plate (`autoUnlock: 'camera'`, else `'app'`) |
| **Check-in**, camera match | If the camera already lowered the arm (a `status_change` to lowered, or a status read within 3 s): only `POST whitelist {plates: []}`. Otherwise `POST unlock {cancelAutoLift: true}` → `POST whitelist {plates: []}` | No second unlock when the camera let the car in. The flag keeps the arm down under the car |
| **Check-in**, "I'm at the bay" (the camera saw a car it couldn't read) | `POST unlock {cancelAutoLift: true}` → `POST whitelist {plates: []}` | |
| **Walk-up** (the camera read the plate of one of the driver's own cars) | `POST unlock` → `POST whitelist {plates: []}` | |
| **Charging** | none | |
| **End of the session**: the car leaves (sensor vacant 10 s) | `raise`: `POST lock` → the next booking's plates if it's armed, else `POST whitelist {plates: []}` (skipped if already empty) | The bay is guarded again. After "Finish" the arm stays down until the car has gone, so it never rises under it |
| **Cancel / no-show** of a booking whose arm was up | `POST whitelist {plates: []}` | The plate can't open the bay outside its slot. The arm stays up |

**Why not `keep-state`:**
- `keep_open` and `keep_closed` are _permanent_ modes. Every change would then need two writes (switch the mode, then move the arm).
- The current mode can't be read back: `GET` has no field for it.
- `cancelAutoLift` gives the same "stays where we put it" in one call. `keep normal` remains a manual recovery step, in case the arm ignores commands.

**The camera's own plate list:**
- **On (the default):** the booked plate goes on the list when the arm goes up. The camera then lowers the arm itself the moment that car pulls up: the lowest latency, and it works even if our server lags. Our own plate match runs too, without a second unlock. The list is emptied at check-in, cancel, no-show and the end of the session.
- **The echo decides:** if the camera's answer lacks the plate (the second spec below keeps only Chinese-format plates), the app logs a warning (no plate in it) and its own match lowers the arm, as without the list.
- **Off (`ECURIOUS_WHITELIST=0`):** the list stays empty, and our own plate match lowers the arm through `unlock`. It tolerates misreads (`samePlate` in [plates.ts](../web/lib/plates.ts)).
- **Both** replace `["*"]` during a hold, and we only ever send `{plates: [...]}`: never `{wildcard: true}`.
- **GDPR:** the plate sits on the vendor's camera only from the arm going up until check-in or the end of the booking.

## Events → the engine

[ecurious-bridge.ts](../web/lib/ecurious-bridge.ts) listens to the stream ([ecurious-events.ts](../web/lib/ecurious-events.ts)) and runs one bridge per Baywatch bay with a lock; each ignores the other locks' events.

| Event | Action |
| --- | --- |
| Any plate read | `carSeen(bay, plate)`: the camera saw a car in front of the arm. Kept in memory for 3 min, only so a walk-up can check the plate is one of the driver's own cars |
| A plate read while a booking is **live**, or with a car already on the sensor | `plateEvent(bay, plate)` at once: the booked car checks in (the arm lowers, or the camera already lowered it) |
| A plate read in a bay with **nothing booked**, sensor vacant | Remembered for 2 min, with no event yet, so a car driving past doesn't mark the bay as taken |
| Sensor: **vacant → occupied** | `plateEvent(bay, <read in the last 2 min, or '' = unreadable>)`. During a live booking with no read, the driver is offered "I'm at the bay" |
| Sensor: **occupied → vacant**, still vacant after `ECURIOUS_VACANT_MS` (10 s) | `vacated(bay)`: the session completes (with any idle fee), a car without a booking is cleared, and the arm rises again. The wait means a sensor flicker never ends a session |
| Arm lowered by the camera itself, with a car on the sensor and no readable plate | The booked car checks in **only if the camera's list is confirmed** to hold just this booking's plates (`listOk === true`). An unknown list (not read yet) or `['*']` proves nothing: the driver gets "I'm at the bay" instead |
| Arm moved, heartbeat, alarm | Update the cached status |

The engine also reads each lock's status every 5 s (cached): a vacant sensor clears a stale "car in the bay" (a missed event, a reconnect), and an occupied one with nobody checked in marks the bay taken.

How it runs:
- **One event at a time.** Events are queued in order, since `plateEvent` waits for the arm. A failing event is logged, and the next one still runs.
- **One set of bridges per process.** `startBridge()` stops any earlier one before starting, so a dev reload never runs two. It waits until the team's lock list has been read (and drops any configured lock that isn't in it).
- **Shared state on `globalThis`.** The engine singleton is already there ([server.ts](../web/lib/server.ts)). The adapter's cache is too, because instrumentation and the route handlers are bundled separately and each get their own copy of the module.
- **Plates stay in memory, never in a log.** Unknown event names are logged by name only.

## Status: the `hardware` field

The engine's tick and `/api/state`, `/api/bays` and `/api/operator` call `status(lockId)` for each lock; clients poll every 2 to 3 s.

- **Reads:** at most one hardware read per lock every 5 s, shared by all callers. Once the bay has been read, a stale value is served while it re-reads in the background, so a poll never waits on the hardware. Events keep the value current in between.
- **Failures:** `status()` never throws. If the service is down, it keeps the last value with `stale: true` and `error`, and tries again 5 s after the last attempt ended.
- **Shape:** the existing `{state, mock}` is kept, and `state` can now also be `'unknown'`. `online` is always present: the mock reports `true`. Live mode adds the following (no plates, ever):

```ts
{ state: 'free' | 'blocked' | 'unknown', mock: false, lockId, name, online,
  carPresence: 'occupied' | 'vacant' | null,
  autoUnlock: 'any' | 'plates' | 'off' | null,  // 'any' = the camera lowers the arm for every car
  listOk: boolean | null,                        // the list is what we last set, or empty if we set nothing (e.g. after a restart);
                                                 // false: it differs, and the engine sets it again; null: not read yet
  battery12V, battery3_7V, signalStrength4G, waterIngress, activeErrors, lastSeenAt,
  events,                                        // the live stream is connected
  stale, error, updatedAt }
```

## Errors and safety

- **Live only by opting in:** it needs `ECURIOUS_API_KEY` **and** `ECURIOUS_LIVE=1`, and `ECURIOUS_MOCK=1` always forces the mock. The key is already in `web/.env`, and the dev server reloads `lib/` on save, so this gate is what keeps a dev session (or an automated UI test) from moving the real arm.
- **No simulator in live mode:** the server refuses to load with `SIMULATOR=1` and `ECURIOUS_LIVE=1` together (a config error), because a faked plate would move the real arm.
- **Timeouts:** 5 s for reads and 8 s for commands, since a command crosses the server's TCP gateway and the device's 4G link.
- **Retries:**
  - Reads retry twice, after 300 ms and then 1 s, on timeouts, network errors, 429 and 5xx.
  - **Commands are never retried:** after a timeout the arm may already be moving.
  - After a failed command, new commands are refused for 30 s without reaching the hardware. That also caps the engine's 5 s no-show retry at about two attempts a minute.
- **Failures surface as errors.**
  - `reserve()` throwing rolls the booking back (502).
  - `release()` throwing restores the check-in state and shows the error.
  - A failed cancel keeps the booking reserved, so the driver can retry.
  - For recovery, an operator can lower the arm from the dashboard (`POST /api/operator/hardware/lower`), and it's logged.
- **The key** travels only in the `X-API-Key` header and is scrubbed from every error message, even when the server echoes it.
- **Plates** are never logged by the adapter, the bridge or the CLI (the CLI masks them), and are never in `status()`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ECURIOUS_API_KEY` | – | The team key, in `web/.env` |
| `ECURIOUS_LIVE` | unset | `1` = the real locks. Anything else = the mock |
| `ECURIOUS_MOCK` | unset | `1` = the mock, even with `ECURIOUS_LIVE=1` |
| `ECURIOUS_BAYS` | `bw-1:lock-0002,bw-2:lock-0003,bw-3:` | Which lock is behind which Baywatch bay; `bw-N:` = no hardware yet. Checked against the team's list at start-up: an unlisted, invalid or retired lock (`lock-0001`) leaves its bay simulated, with a warning |
| `ECURIOUS_LOCK_ID` | unset | The lock the CLI and any caller that names no lock use (e.g. `lock-0002`). No fallback: unset means none |
| `ECURIOUS_WHITELIST` | on | `0` = don't use the camera's plate list; the app's own match lowers the arm |
| `ECURIOUS_VACANT_MS` | `10000` | How long the car sensor must read vacant before the car counts as gone |
| `SIMULATOR` | unset | `1` = the demo panel. Its fake plate and occupancy events work for simulated bays (`bw-3`, `ge-*`) and are refused (403) for bays with a real lock |

These are fixed in code, not env: the timeouts (5 s / 8 s), the read backoff (300 ms, 1 s), the status cache (5 s), the team list cache (5 min), the command cooldown (30 s, per lock), how long a plate read stays fresh (2 min for check-in, 3 min for walk-up), the wait for the camera to lower the arm itself (3 s), the stream's reconnect backoff (1 s to 30 s) and its silence limit (60 s).

## Files

| File | What |
|---|---|
| [lib/ecurious.ts](../web/lib/ecurious.ts) | The adapter, one call per lock: `raise()`, `lower()`, `setPlates()`, `status()`, `teamLocks()`; the REST client and the shared cache |
| [lib/ecurious-events.ts](../web/lib/ecurious-events.ts) | The event stream: parser, event names, reconnect with backoff and a silence watchdog |
| [lib/ecurious-bridge.ts](../web/lib/ecurious-bridge.ts) | Events → the engine, one bridge per lock. Started once by [instrumentation.ts](../web/instrumentation.ts) (Node.js runtime, live mode only) |
| [lib/ecurious-cli.ts](../web/lib/ecurious-cli.ts) | A console for supervised tests: one call per run |
| `lib/ecurious*.test.ts`, `lib/schedule.test.ts` | Parsing, event mapping, status, caching, errors and safety with HTTP stubbed; the engine's hardware call sequence against a mocked lock (`npm test`) |

The secret-protected webhook `POST /api/plate-events` stays as it is, for any other camera source.

## Phase 2: the live test at the bay

**Roles:**
- **Operator:** at the laptop, runs every command.
- **Spotter:** at the bay, on a call with the operator, and says "clear" before every movement. **Anyone** can say STOP.
- **Driver:** with a test car whose plate is registered in the app.

**Every command below is run from `web/`:**

```sh
hw() { node --env-file=.env lib/ecurious-cli.ts "$@"; }   # reads: bays | status | plate | watch [s]
export ECURIOUS_LOCK_ID=lock-000N                          # the bay in front of you (step 0)
# writes also need ECURIOUS_LIVE=1, as a prefix on that one command: it doesn't stick (zsh and bash)
```

**Abort, at any time:**
1. Say STOP. Nobody sends another command.
2. If the arm must go down, send **one** `ECURIOUS_LIVE=1 hw lower`. Down is the safe direction for a ground lock.
3. To stop all automation, stop the dev server (Ctrl+C), or set `ECURIOUS_MOCK=1` and restart it.
4. If a command timed out, **don't resend it**. Wait 30 s, run `hw status`, then decide.
5. If the arm doesn't move: run `hw status` (offline? errors?). Then send `ECURIOUS_LIVE=1 hw keep normal` once, and call an Ecurious mentor. The vendor dashboard's Unlock button is the fallback control.

### Step 0: read-only baseline

1. Run `hw bays`. Expect three bays, `vacant`, and `whitelist ["*"]`.
2. **Find our bay:** read the serial on the physical lock, match it to a `serialHex`, and set `ECURIOUS_LOCK_ID` to that bay.
3. Leave `hw watch 1800` running in a second terminal. It shows every event, with plates masked.

### Step 1: the first movement, down (the arms were all up on 2026-10-24)

1. **Spotter:** no people, objects or cars on or near the arm. Says "clear".
2. **Operator:** `ECURIOUS_LIVE=1 hw lower`.
   - Expect `{"success": true, "message": "Unlock command sent … Barrier is lowering.", "result": {"deviceStatus": 2, …}}`.
   - Within seconds, expect a `lock:status_change` with `"status":"lowered"` in the watch terminal.
   - **Note the real event name and payload,** and the time from command to event.
3. Leave the bay empty for 3 minutes. Expect the arm to stay down, with no `status_change`: that's `cancelAutoLift` working.

### Step 2: what auto-lift means (optional)

1. **Spotter:** clear. **Operator:** `ECURIOUS_LIVE=1 hw raise`, then expect a `status_change` to `raised`.
2. **Spotter:** clear. **Operator:** `ECURIOUS_LIVE=1 hw lower --auto-lift`. This is the only command sent with `cancelAutoLift: false`.
3. **Spotter keeps the bay clear,** because the arm may rise by itself. Watch for up to 5 minutes. If it rises unprompted, auto-lift is a timer: note the delay.
4. Finish with `ECURIOUS_LIVE=1 hw lower`, which sends the flag.

### Step 3: the camera's plate list (this decides `ECURIOUS_WHITELIST`)

1. **Spotter:** clear. **Operator:**
   - `ECURIOUS_LIVE=1 hw raise`.
   - `ECURIOUS_LIVE=1 hw whitelist <TEST PLATE>`. Spaces and dashes are removed.
   - Check the echoed `whitelist` (masked: first and last 2 characters). If the plate is missing or changed, the camera wants Chinese-format plates: keep `ECURIOUS_WHITELIST` off and skip to step 4 below.
2. **Driver:** pulls up slowly and stops **in front of** the raised arm.
   - Expect a `lock:photo_captured` with the plate, masked. Check that the read matches the car.
   - If the list works, expect the arm to **lower by itself** (`status_change` to `lowered`) with no command from us. Note the latency.
   - The driver moves only once the arm is fully down and the spotter says go. Then they reverse out.
3. **Operator:** `ECURIOUS_LIVE=1 hw whitelist`, with no plate (disables auto-lowering). If the arm is down, send `ECURIOUS_LIVE=1 hw raise` (spotter: clear).
4. **Driver:** pulls up again and stops in front of the arm. Expect a `photo_captured`, **with the arm staying up.** That proves a hold with `[]` really holds. Then reverse out.
5. **Spotter:** clear. **Operator:** `ECURIOUS_LIVE=1 hw lower`. The bay is now free.

### Step 4: the full cycle in the app (the challenge's prerequisite)

1. **Configure.** In `web/.env`:
   - set `ECURIOUS_LIVE=1`, `ECURIOUS_BAYS=bw-1:lock-0002,bw-2:lock-0003,bw-3:` and `ECURIOUS_LOCK_ID=lock-0002`;
   - the camera's plate list is on; set `ECURIOUS_WHITELIST=0` only if step 3 failed;
   - set `BAY_LAT`/`BAY_LNG` to the venue, for the fallback check-in;
   - `SIMULATOR=1` may stay: the demo panel then works for `bw-3` and GoingElectric bays only.
2. **Clear the dev server.** Make sure no one, and no agent, is running automated UI tests against it. Restart it.
   - Expect `[ecurious] live events connected, bays bw-1 (lock-0002), bw-2 (lock-0003)` in the log.
   - On `/operator`, the "mock hardware" label disappears.
3. **Reserve.** **Spotter:** clear. **Driver:** reserves the bay in the app with the test car.
   - Expect the arm to rise (`status_change` to `raised`) and the app to show "Reserved".
   - `hw status` shows `whitelist []` (or the masked plate).
   - If the bay is occupied or offline, the booking fails with that message, and nothing moves.
4. **Arrive.** **Driver:** pulls up and stops in front of the raised arm.
   - Expect a `photo_captured`. The app matches the plate and sends `unlock {cancelAutoLift: true}`. Expect the arm to lower and the app to show "Checked in" (camera).
   - **On a misread,** a fuzzy match still checks in. An unreadable plate offers "I'm at the bay". A wrong plate pauses the hold and alerts the operator: resolve it on `/operator`, then use "I'm at the bay".
5. **Park.** **Driver:** parks once the arm is fully down. Expect `car_presence` to `occupied`.
6. **Charge.** **Driver:** taps Start charging (plugs in, if the charger is live).
7. **Release.** Either:
   - **Finish:** the driver taps Finish, gets the receipt, and the arm stays down; or
   - **Drive out:** the driver leaves. Expect `car_presence` to `vacant`, then after 10 s the session completes with a receipt.
8. **Check.** `hw status` shows `lowered`, `vacant` and `whitelist []`. Three minutes later the arm is still down, so the bay is open to the public.

**Optional, for the jury:**
- **Cancel:** reserve, then cancel. Expect the arm to lower.
- **No-show:** reserve with `HOLD_MINUTES=2`, then don't arrive. **The arm lowers on its own at the deadline:** tell the spotter the time.
- **Occupied bay:** reserve while a car stands on the bay. Expect the booking to be refused, with nothing moving.

## Open questions for the Ecurious mentors

- Which bay is physically ours at the venue?
- Auto-lift: how long is the timeout, and does it also re-raise after a car leaves? Is `cancelAutoLift` per command, or a device setting?
- The camera list: are German plates stored as sent (spaces, umlauts, a province prefix)? Is `["*"]` the intended default?
- Does the camera also send `photo_captured` for departing cars? Is the presence event `lock:car_presence`, with `presence`?
- Does `keep_closed` also block the camera's auto-lowering, and can the current mode be read?
- `battery3_7V` and `signalStrength4G` read 0 on every bay: are they reported at all?
