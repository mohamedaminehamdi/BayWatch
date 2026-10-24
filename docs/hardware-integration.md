# Hardware integration: the Ecurious bay

_Last updated: 2026-10-24. **Verified live (read-only):** the bay list, bay details, the latest plate and the event stream, through our own client. **Still to verify at the bay (phase 2):** every command that moves the arm, the camera's plate list and auto-lift. Until then, the app runs on the mock unless `ECURIOUS_LIVE=1` is set._

## In short

- The bay has a **Chang Cheng CC5S ground lock**: a barrier arm with a car sensor and a plate camera. It sits behind the Ecurious server, which we reach with REST calls and a live event stream (Server-Sent Events). The key goes in an `X-API-Key` header for both, so it never appears in a URL.
- **Reserve** raises the arm. **Check-in** lowers it with `cancelAutoLift: true`, so it can't rise again under the car, nor after the car has left. **The end of the session** needs no call, because the arm is already down and the bay is open to anyone.
- **Every bay ships with the camera's plate list set to `["*"]`**, so the camera lowers the arm for _any_ car it reads. That would defeat a hold. A reservation therefore replaces the list. The engine calls `hw.reserve([plate])`, and the adapter sets `[]` by default, or the booked plate with `ECURIOUS_WHITELIST=1`. We never send `wildcard`.
- **Camera and sensor events** reach the reservation engine through a bridge that `instrumentation.ts` starts once per server:
  - a plate read becomes `plateEvent(plate, 'in')`;
  - the car sensor going vacant for 10 s becomes `vacated()`: the car left, and no plate is needed.
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
| Event names | `status_change`, `vehicle_presence`, `photo_captured`, `alarm` | Prefixed: `lock:heartbeat` (seen). The vendor dashboard listens for `lock:status_change`, **`lock:car_presence`** and `lock:photo_captured`. Plus a `connected` event, and a heartbeat that isn't documented |
| `status` | `"raised"` or `"lowered"` | Also **`"offline"`**: `lock-0001` was offline from 10:29 (last seen) until at least 10:58, and back to `"raised"` by 11:20. `deviceStatusRaw` keeps the last position (1 raised, 2 lowered) |
| Lock fields | 12 fields | Also `deviceStatusRaw`, `carPresenceRaw` (2 = vacant), `whitelist`, and `latestPhoto` on a bay with a read |
| The list response | `{team, locks}` | `{team, locks, assignedLocks}`, with the same list twice |
| `plateType` | `"standard"` | `"0"` |
| `battery3_7V`, `signalStrength4G` | Example values 3.9 and 28 | **0 on every bay**. `battery12V` is 15.0–15.1 V, above a 12 V battery's level, so the units are probably on mains power |
| `/whitelist`, spec 1 | `{plates: ["MBD14E","B12345"]}` stores both; `{wildcard: true}` means any car; `{plates: []}` disables auto-lowering | The vendor dashboard sends exactly these three bodies |
| `/whitelist`, spec 2 (same endpoint, documented twice) | "Up to 10 plates"; the request `["吉MBD14E","粤B88888","MBD14E"]` answers "uploaded **2** … rule(s)" and stores only the two plates **with a Chinese province prefix** | Unverified. A German plate might be dropped the same way, so the adapter checks the echo and warns, and `ECURIOUS_WHITELIST` stays off until phase 2 settles it |
| The default list | Not stated | **`["*"]` on all three bays:** any car lowers the arm. The vendor dashboard also shows a missing list as "ANY PLATE" |
| `cancelAutoLift` | "If true, disables auto-relift timeout", on unlock (and accepted on lock) | The vendor dashboard sends `{cancelAutoLift: true}` on **lock** and `{}` on unlock. The timeout's length and trigger are unverified (phase 2, step 4) |
| Auth in examples | `?apiKey=` everywhere | The `X-API-Key` header works for REST and for the event stream |

## How the app maps onto the hardware

The engine ([reservation.ts](../web/lib/reservation.ts)) calls `hw.reserve()` and `hw.release()`. The adapter ([ecurious.ts](../web/lib/ecurious.ts)) turns them into the calls below.

| App moment | Hardware calls | Why |
|---|---|---|
| **Reserve** (`hw.reserve([plate])`) | A fresh `GET` of the bay → `POST lock {cancelAutoLift: true}` → `POST whitelist {plates: []}` (or `[booked plate]` with `ECURIOUS_WHITELIST=1`) | **The read:** we never raise the arm onto a car (`carPresence` must be `vacant`) or on an `offline` bay. Either refusal rolls the booking back with a 502, `The bay could not be reserved: <reason>`. **The plate list:** this is what makes the hold hold, because `["*"]` lowers the arm for any car. **The flag:** sent as the vendor dashboard does; harmless on a raised arm |
| **Check-in**: a camera match or the fallback (`hw.release`) | `POST unlock {cancelAutoLift: true}` → `POST whitelist {plates: []}` (skipped if already empty) | In "normal" mode the device raises the arm again after a timeout. That could catch the car while it's still manoeuvring, and after the session it would close a bay the app shows as free. With the flag, the arm stays down until our next `lock` |
| **Charging** | none | |
| **End of the session**: Finish, or the car leaves | none | The arm has been down since check-in and the flag keeps it down, so the bay is open to the public. The camera list is already empty |
| **Cancel / no-show** (`hw.release`) | Same as check-in | The bay goes back to the public |

**Why not `keep-state`:**
- `keep_open` and `keep_closed` are _permanent_ modes. Every change would then need two writes (switch the mode, then move the arm).
- The current mode can't be read back: `GET` has no field for it.
- `cancelAutoLift` gives the same "stays where we put it" in one call. `keep normal` remains a manual recovery step, in case the arm ignores commands.

**The camera's own plate list** (`ECURIOUS_WHITELIST=1`):
- **On:** the booked plate goes on the list at reserve time. The camera then lowers the arm itself the moment that car pulls up: the lowest latency, and it works even if our server lags. The list is cleared at check-in, cancel or no-show.
- **Off (the default):** our own plate match does it. It tolerates misreads (`samePlate` in [plates.ts](../web/lib/plates.ts)) and lowers the arm through `release()`.
- **Both modes** replace `["*"]` during a hold.
- **"Different car today":** that second plate doesn't go on the camera's list. Our own plate match still lets it in, through `release()`.
- **GDPR:** the plate sits on the vendor's camera only for the length of the booking.

## Events → the engine

[ecurious-bridge.ts](../web/lib/ecurious-bridge.ts) listens to the stream ([ecurious-events.ts](../web/lib/ecurious-events.ts)) and ignores the other bays' events.

| Event | Action |
|---|---|
| A plate read while the bay is **held** (`reserved`), or with a car already on the sensor | `plateEvent(plate, 'in')` at once. The booked car checks in and the engine lowers the arm; another car pauses the hold and alerts the operator |
| A plate read in an **unbooked** bay, with the sensor vacant | Remembered for 2 min, with no event yet, so a car driving past doesn't mark the bay as taken |
| Sensor: **vacant → occupied** | `plateEvent(<read in the last 2 min, or '' = unreadable>, 'in')`. With no booking, that marks the bay "a car without a booking". During a hold with no read, the driver is offered the fallback check-in |
| Sensor: **occupied → vacant**, still vacant after `ECURIOUS_VACANT_MS` (10 s) | `vacated()`: the session completes (with any overstay billed), or a blocker is cleared. It needs no plate, so a session checked in by hand ends too. The wait means a sensor flicker never ends a session |
| Arm moved, heartbeat, alarm | Update the cached status |

How it runs:
- **One event at a time.** Events are queued in order, since `plateEvent` waits for the arm. A failing event is logged, and the next one still runs.
- **One bridge per process.** `startBridge()` stops any earlier bridge before starting, so a dev reload never runs two.
- **Shared state on `globalThis`.** The engine singleton is already there ([server.ts](../web/lib/server.ts)). The adapter's cache is too, because instrumentation and the route handlers are bundled separately and each get their own copy of the module.
- **Plates stay in memory, never in a log.** Unknown event names are logged by name only.

## Status: the `hardware` field

`/api/state` and `/api/operator` call `ecurious.status()` on every poll, and every client polls every 2 s.

- **Reads:** at most one hardware read every 5 s, shared by all callers. Once the bay has been read, a stale value is served while it re-reads in the background, so a poll never waits on the hardware. Events keep the value current in between.
- **Failures:** `status()` never throws. If the service is down, it keeps the last value with `stale: true` and `error`, and tries again 5 s after the last attempt ended.
- **Shape:** the existing `{state, mock}` is kept, and `state` can now also be `'unknown'`. `online` is always present: the mock reports `true`. Live mode adds the following (no plates, ever):

```ts
{ state: 'free' | 'blocked' | 'unknown', mock: false, lockId, name, online,
  carPresence: 'occupied' | 'vacant' | null,
  autoUnlock: 'any' | 'plates' | 'off' | null,  // 'any' = the camera lowers the arm for every car
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
|---|---|---|
| `ECURIOUS_API_KEY` | – | The team key, in `web/.env` |
| `ECURIOUS_LIVE` | unset | `1` = the real bay. Anything else = the mock |
| `ECURIOUS_MOCK` | unset | `1` = the mock, even with `ECURIOUS_LIVE=1` |
| `ECURIOUS_LOCK_ID` | The team's first bay (`lock-0001`) | The bay at the venue. **Set it explicitly:** match the serial printed on the device with `serialHex` |
| `ECURIOUS_WHITELIST` | unset | `1` = the booked plate goes on the camera's list during the hold |
| `ECURIOUS_VACANT_MS` | `10000` | How long the car sensor must read vacant before the car counts as gone |

These are fixed in code, not env: the timeouts (5 s / 8 s), the read backoff (300 ms, 1 s), the status cache (5 s), the command cooldown (30 s), how long a plate read stays fresh (2 min), the stream's reconnect backoff (1 s to 30 s) and its silence limit (60 s).

## Files

| File | What |
|---|---|
| [lib/ecurious.ts](../web/lib/ecurious.ts) | The adapter: `reserve()`, `release()`, `status()` (keeping the mock's signatures), the REST client, the shared cache, the bay choice |
| [lib/ecurious-events.ts](../web/lib/ecurious-events.ts) | The event stream: parser, event names, reconnect with backoff and a silence watchdog |
| [lib/ecurious-bridge.ts](../web/lib/ecurious-bridge.ts) | Events → `reservations.plateEvent`. Started once by [instrumentation.ts](../web/instrumentation.ts) (Node.js runtime, live mode only) |
| [lib/ecurious-cli.ts](../web/lib/ecurious-cli.ts) | A console for supervised tests: one call per run |
| `lib/ecurious*.test.ts` | 23 tests: parsing, event mapping, status mapping, caching, errors and safety, with HTTP stubbed (`npm test`) |

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
   - set `ECURIOUS_LIVE=1` and `ECURIOUS_LOCK_ID=lock-000N`;
   - set `ECURIOUS_WHITELIST=1` only if step 3 worked;
   - set `BAY_LAT`/`BAY_LNG` to the venue, for the fallback check-in;
   - leave **`SIMULATOR` unset**.
2. **Clear the dev server.** Make sure no one, and no agent, is running automated UI tests against it. Restart it.
   - Expect `[ecurious] live events connected, bay lock-000N` in the log.
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
