# API calls

_Last updated: 2026-10-24, booking v2. Partner developers: [api.md](api.md) and the OpenAPI 3.1 spec at [`/openapi.json`](../web/public/openapi.json). Voice: [voice-booking.md](voice-booking.md). Card payments: [payments.md](payments.md). Types: [booking-types.ts](../web/lib/booking-types.ts)._

## Conventions

- **Our routes:** JSON in and out. Errors are `{"error": "…"}` with a matching status:
  - 400 bad input (off the grid, too long, too far ahead);
  - 401 signed out or a bad secret;
  - 402 payment not confirmed;
  - 403 not yours, too far from the bay, not one of your plates, or a demo event on a bay with a real lock;
  - 404 not found, or a disabled demo route;
  - 409 a taken slot, the 3-booking limit, a price change ("The price is now €X"), wrong state, or a car in the bay;
  - 413 body over 10 KB;
  - 502 hardware or GoingElectric failure;
  - 503 voice switched off.
- **Partner routes** answer in the OCPI envelope instead ([api.md](api.md#errors)).
- **Auth types:**
  - **Public:** no auth.
  - **Driver:** a Clerk session: the web's session cookie, or the Flutter app's session token as `Authorization: Bearer <jwt>` (Clerk's `auth()` accepts both).
  - **Owner:** the driver who made the booking. Anyone else gets 404.
  - **Operator:** an email in `OPERATOR_EMAILS`.
  - **Secret:** `x-webhook-secret`.
  - **Partner:** `Authorization: Token`.
  - **Vapi:** `Authorization: Bearer` with `VAPI_BEARER_SECRET`.
- **Shapes:** money in integer euro cents, times in ms timestamps. Bay ids are `bw-1` … `bw-3` (Baywatch bays) or `ge-<ge_id>` (GoingElectric, simulated guard).
- **CORS** on `/api/*`: any origin; methods `GET, POST, DELETE, OPTIONS`; headers `content-type, authorization`.

## Bays and slots

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/bays?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]` | Public | Map bounds | `{bays, realBays, warning?, more?}`. `bays` are the GoingElectric chargers in the box, every one bookable. `realBays` are the Baywatch bays, always, whatever the box. A `Bay` has: `id, name, lat, lng, address, network?, points, powerKw, class, real, guard, status (free, reserved, occupied, offline), led (green, red), nextBookingAt?, priceFromCents`. |
| `GET /api/bays/{id}` | Public | – | The bay, plus today's blocks (the viewer's own show as `mine`) |
| `GET /api/bays/{id}/availability?date=YYYY-MM-DD` | Public | Berlin date, today by default | `{bayId, date, blocks: [{start, state: free, booked, gap, past or mine}], maxBlocks, class}`. 96 blocks a day (92 or 100 on daylight-saving days). |
| `GET /api/bays/{id}/quote?start=<ms>&blocks=<n>` | Public (personalised) | A slot, or `?start=now` for "Book now" (`blocks` ignored; the answer's `start` and `end` say what the slot is) | `{bayId, start, end, blocks, class, cents, demand, multiplier, creditAppliedCents, payCents, noShowCents, cancelSchedule, valid, reason?}` |
| `POST /api/bays/{id}/unlock` | Driver | `{lat, lng}`, used once and not stored | **Walk-up:** unlocks a free bay with no booking within 30 min + the gap, until the next booking's start − the gap. Within 150 m; a real lock also needs its camera to have read one of the driver's own plates in the last 3 min (403 otherwise). |
| `GET /api/chargers?…` | Public | Map bounds | GoingElectric chargers, without booking data (used by the landing page and older screens) |

## Bookings

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/reservations` | Driver | `{bayId, start, blocks, vehicleId, priceCents, acceptFees: true}`, or **"Book now"**: `{bayId, now: true, vehicleId, priceCents, acceptFees: true}`, where the server sets the slot (from the block under way, for at least an hour). `priceCents` is the quote the driver saw. | The `ReservationView`. **Payment is decided on the server** ([booking-api.ts](../web/lib/booking-api.ts)): a `payment` field from the browser is ignored, and the demo payment is used while Stripe isn't wired into v2. 400 bad slot; 409 taken, limit or price changed; 502 `The bay could not be reserved: <reason>` when a real arm can't rise (offline, a car over the arm); the booking is rolled back. The old `{vehicleId, minutes}` without `bayId` still books Baywatch Bay 1 from the next block. |
| `GET /api/bookings?v=2` | Driver | – | `{upcoming, active, past, creditCents, firstFree}`. Without `v=2`: the old screen's past list (deprecated). |
| `GET /api/reservations/{id}` | Owner | – | The `ReservationView`: `id, bayId, bayName, real, guard, class, start, end, blocks, status (upcoming, live, arrived, charging, completed, cancelled, no_show, walkup), arriveBy, feeCents, demand, charges, blockedSince?, reroute?, carAtBay?, plateHint?, vehicleLabel?, cancelNowCents` |
| `POST /api/reservations/{id}/cancel` | Owner | – | Cancels at the current tier. Free while blocked. |
| `POST /api/reservations/{id}/checkin` | Owner | `{lat, lng}` | **Fallback check-in:** needs camera or sensor evidence of a car in the last 3 min on a real lock, and 150 m. Location alone never lowers an arm. |
| `POST /api/reservations/{id}/charge`, `/finish` | Owner | – | Start charging. Finish: ends the session, billing overstay after 5 free min. |
| `POST /api/reservations/{id}/plate` | Owner | `{vehicleId}` or `{plate, consent: true}` | "Different car today" |

## Demo, camera and operator

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/sim/demand` | Driver + `SIMULATOR=1` | `{level: quiet, normal, busy or full}`, or `{level: null}` | Overrides demand everywhere (null goes back to time of day) |
| `POST /api/sim/bay` | Driver + `SIMULATOR=1` | `{bayId, occupied}` | Puts a car in a **simulated** bay, or takes it out. **403 on a real lock.** |
| `POST /api/sim/plate-events` | Driver + `SIMULATOR=1` | `{bayId, plate, direction}` | Fakes a camera read on a **simulated** bay. **403 on a real lock.** |
| `POST /api/plate-events` | Secret | `{bayId, plate, direction}` | For other camera sources. **403 on a real lock**, which only takes its own camera stream. |
| `GET /api/operator` | Operator | – | Per real bay: status, alerts (plates until resolved), the hardware panel, the event log and 7-day KPIs, including credits issued, the overstay split and walk-ups |
| `POST /api/operator/alerts/{id}/resolve` | Operator | – | Resolves an alert, resumes the hold and erases the plate |
| `POST /api/operator/hardware/lower` | Operator | – | Recovery: lowers the arm and logs it. 502 with the adapter's message. |
| `POST /api/operator/simulate` | Operator + `SIMULATOR=1` | – | "Simulate a week" |

## Voice and payments

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/voice/session` | Driver + `VOICE_DEMO=1` | A 15-minute session token naming the driver, signed with `VOICE_SESSION_SECRET`, for the in-app mic |
| `POST /api/voice/vapi` | Vapi | Vapi tool calls `quote_reservation` / `confirm_reservation`. The driver comes from the signed token (or `VOICE_DEMO_USER_ID` for phone calls), never from the caller or the model. Demo payment only. |
| `POST /api/payments/intent` | Driver + Stripe keys | A card hold (test mode). Built, but not yet wired into booking v2 ([payments.md](payments.md)). |

## App config

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/config` | Public | `{clerkPublishableKey, vapi: {publicKey, assistantId} \| null}`: this server's `NEXT_PUBLIC_*` values (public by design), so the Flutter app signs in to the same Clerk instance and shows the mic only when voice is set up. Never a secret. |

## Older routes (deprecated)

Kept for the old screens until they go: `GET /api/state` (the shell's summary, viewer-aware), `POST /api/reservation/{action}`, `/api/waitlist` (remembers the choice only), and `GET/POST/DELETE /api/vehicles` (current, not deprecated).

## Partner routes

`POST /ocpi/2.2.1/commands/RESERVE_NOW` and `CANCEL_RESERVATION`, plus `GET /api/partner/v1/reservations/{id}`.
- `location_id` is a bay id. RESERVE_NOW takes an optional `ecurious_start` (on the grid) and `ecurious_blocks`, and defaults to the current block and the class maximum.
- Hardware refusals come back as REJECTED with the reason.
- Full guide: [api.md](api.md).

## External calls we make

| Service | From | When | Notes |
|---|---|---|---|
| **GoingElectric** | Server ([goingelectric.ts](../web/lib/goingelectric.ts)) | The map moves, the landing page renders (cached 6 h) | Key server-side only. Up to 500 per call. |
| **Ecurious lock API** | Server ([ecurious.ts](../web/lib/ecurious.ts)) | Live mode only (`ECURIOUS_API_KEY` + `ECURIOUS_LIVE=1`), per lock | `GET /locks` (validates `ECURIOUS_BAYS` at start-up), `GET /locks/:id`, `POST /locks/:id/lock` and `/unlock` `{cancelAutoLift: true}`, `POST /locks/:id/whitelist {plates}`. **The camera whitelist is on:** the booked plate is posted when the arm rises and cleared at the end; `wildcard` is never sent. `lock-0001` is never called. [Details](hardware-integration.md) |
| **Ecurious events** | Server, through the bridge | Live mode | SSE `lock:photo_captured`, **`lock:car_presence_changed`**, **`lock:status_changed`**, `lock:heartbeat` |
| **Clerk** | Browser and server | Every request; cars and the credit wallet in `privateMetadata` | Accountless dev keys until claimed |
| **Resend** | Server ([notify.ts](../web/lib/notify.ts)) | A blocked-bay alert | No plate in the email |
| **Vapi** | Browser (mic) and Vapi → our webhook | Voice booking | `NEXT_PUBLIC_VAPI_*` for the mic. The webhook needs the bearer secret. |
| **Stripe** | Server and browser | Test mode, when both keys are set | Not wired into v2. Keys paused for the demo. |
| **Nominatim** | Browser | A submitted search | No autocomplete (usage policy) |
| **OpenFreeMap** | Browser (MapLibre) | The map | No key |
| **Browser APIs** | Browser | Locate me, check-in, walk-up, reminders | Geolocation (never stored), Notification |
