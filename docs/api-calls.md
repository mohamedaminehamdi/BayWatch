# API calls

_Last updated: 2026-10-24, with the partner API and the fee rules wired. Partner developers should start with [api.md](api.md), the integration guide for other charging apps, and the OpenAPI 3.1 spec at [`/openapi.json`](../web/public/openapi.json)._

## Conventions

- **Our app's routes** return JSON in and out. Errors come back as `{"error": "…"}` with a matching HTTP status:
  - 400 invalid input;
  - 401 signed out or a bad secret;
  - 402 payment not confirmed;
  - 403 not yours, or not an operator;
  - 404 not found, or a disabled demo route;
  - 409 wrong state, bay busy, or the price changed;
  - 413 body over 10 KB;
  - 502 hardware or GoingElectric failure.
- **Partner routes** answer in the OCPI envelope `{data, status_code, status_message, timestamp}` instead ([errors](api.md#errors)).
- **Auth types:**
  - **Public:** no auth.
  - **Driver:** a Clerk session (cookie in the web app; a Bearer session token later for Flutter).
  - **Owner:** a driver who made this reservation.
  - **Operator:** a driver whose email is in `OPERATOR_EMAILS`.
  - **Secret:** the `x-webhook-secret` header.
  - **Partner:** `Authorization: Token <token>`, plain or Base64, from `OCPI_PARTNER_TOKENS`.
- **CORS** on `/api/*`: any origin; methods `GET, POST, DELETE, OPTIONS`; headers `content-type, authorization`.
- Money is integer euro cents, and times are ms timestamps. The partner API uses RFC 3339 times.

## Our routes

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/state` | Public (personalised when signed in) | – | `bay` (id, name, address, lat, lng, powerKw), `session` (type, label, maxMinutes, presets), `holdMinutes`, `simulator`, `hardware`, `reservation`, `blockedSince`, `waiting`, `priority` {until, mine}, `quote` {type, cents, demand, multiplier, prepaid, warning, noShowCents}, `log`.<br><br>**`hardware`** is the adapter's status: `state`, `mock` and `online` (always present). In live mode it adds `lockId`, `carPresence`, `autoUnlock`, the batteries, signal, water ingress, errors, `lastSeenAt`, `events` (stream connected), `stale` and `updatedAt`. It never includes plates.<br><br>**Other drivers** see `reservation` only as {id, status, expiresAt, end, mine: false}.<br><br>**The owner** also gets `type`, `start`, `feeCents`, `demand`, `prepaid`, `charges` (kinds: reservation, extension, overstay, refund, released), `totalCents`, `sentReminders`, a masked plate (`plateHint`), and `carAtBay`, which says whether the fallback check-in is open. `expiresAt` is the arrival deadline. |
| `GET /api/chargers?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]` | Public | Map bounds, plus optional whole kW | `{chargers: [{id, name, lat, lng, address, network, points: [{count, power, type}], fault, url}], more?, warning?}`. 400 on bad bounds or `min_power`, 502 if GoingElectric fails. Without a key: an empty list plus a `warning`. |
| `POST /api/reservations` | Driver | `{vehicleId, minutes, priceCents, acceptFees: true, payment: "demo"}`. `priceCents` is the `quote.cents` the driver saw. | The owner's reservation view. 402 without `payment`. 400 for fees not accepted, no price, or a session outside the type's maximum (2 h fast, 4 h slow). 404 unknown car. 409 for: bay reserved, car in bay, held for a waiting driver, or "The price is now €X" when demand moved since. 502 `The bay could not be reserved: <reason>` when the bay is offline, a car is on the sensor or the hardware doesn't answer; the booking is rolled back. |
| `POST /api/reservation/{action}` | Owner | See the actions table below | The owner's reservation view. 403 not yours, 404 unknown action, 409 wrong state |
| `GET /api/bookings` | Driver | – | The driver's own ended reservations (owner views, plates erased) |
| `GET /api/vehicles` | Driver | – | `[{id, plate, display, label, consentAt}]` |
| `POST /api/vehicles` | Driver | `{plate, label?, consent: true}` | The new car. 400 for no consent, a bad plate or a label over 30 characters. 409 for a duplicate or more than 5 cars. |
| `DELETE /api/vehicles/{id}` | Driver | – | `{ok: true}`, or 404 |
| `POST /api/waitlist` | Driver | – | `{position}`. 409 if the bay is free, already yours, or held for you. |
| `DELETE /api/waitlist` | Driver | – | `{ok: true}`. Leaving while you hold the priority window passes it on. |
| `POST /api/plate-events` | Secret | `{plate, direction?: "in" \| "out"}`. An empty plate means "unreadable". | `{matched, matchedBy?: "exact" \| "fuzzy"}`. 401 bad or missing secret, which also covers an unset `WEBHOOK_SECRET`. 400 bad `direction`. |
| `POST /api/sim/plate-events` | Driver + `SIMULATOR=1` | Same as above | Same. 404 when the simulator is off. |
| `POST /api/sim/demand` | Driver + `SIMULATOR=1` | `{level: "quiet" \| "normal" \| "busy" \| "full"}`, which sets site occupancy to 15%, 50%, 80% or 95% | The new `quote`, priced quiet, normal, busy or peak. 400 for an unknown level, 404 when the simulator is off. |
| `GET /api/operator` | Operator | – | `bay`, `simulator`, `hardware`, the live `reservation` (public view), `blockedSince`, `alerts` (with the plate until resolved), `log`, `stats` (7-day `days[]` + `kpis`) |
| `POST /api/operator/alerts/{id}/resolve` | Operator | – | The resolved alert. The driver's hold resumes and the plate is erased. 404 unknown, 409 already resolved. |
| `POST /api/operator/simulate` | Operator + `SIMULATOR=1` | – | `{bookings, incidents}`. Replaces earlier simulated data. |
| `POST /api/operator/hardware/lower` | Operator | – | Recovery, from the hardware panel: lowers the arm, for example after a reserve command timed out, and logs it. A booking in progress isn't changed. Returns `{hardware}`, or 502 with the adapter's message. |

### Actions on `POST /api/reservation/{action}`

| Action | Body | Allowed when | Effect |
|---|---|---|---|
| `cancel` | – | `reserved` | Releases the bay. Refunds everything except the cancellation fee, and it's free within 2 min or while the bay is blocked. If the hardware fails: 502 `Could not release the bay: …`, and the booking stays reserved, so the driver can retry. |
| `extend` | – | `reserved`, once | +5 min on the arrival deadline, for €0.50 |
| `checkin` | `{lat, lng}` | `reserved`; no other car in the bay; **the bay saw a car in the last 3 min** (an unreadable plate read, or the presence sensor once it's wired); and the driver within 150 m | Fallback check-in: releases the bay with `checkInMethod: "fallback"`. 409 "The bay camera hasn't seen your car yet", 409 another car in the bay, 400 no location, 403 too far. The coordinates aren't kept. |
| `other-plate` | `{plate, consent: true}` | `reserved` | "Different car today": the camera also accepts this plate, which is erased at the end |
| `charge` | – | `arrived` | `status: charging` |
| `finish` | – | `arrived` or `charging` | Ends the session. Adds an overstay fee if past the session end plus 15 min. |

## Partner routes

All fields, examples and error codes are in [api.md](api.md). Code: [partners.ts](../web/lib/partners.ts).

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /ocpi/2.2.1/commands/RESERVE_NOW` | Partner | An OCPI ReserveNow: `token` {uid, contract_id, type, valid?}, `reservation_id`, `location_id` (= `BAY_ID`), `evse_uid?`, `expiry_date`, `response_url?` (checked, never called). Plus 4 required extensions: `ecurious_license_plate`, `ecurious_plate_consent: true`, `ecurious_session_minutes`, `ecurious_fee_cents` (the fee the driver accepted). | A CommandResponse `{result, timeout: 0, message, ecurious_arrive_by, ecurious_fee_cents}`. HTTP 200 for both **ACCEPTED** and **REJECTED**. A request is rejected when the bay is taken, the location is unknown, the token is invalid, `expiry_date` has passed, or the price moved (the answer includes the new price). 400/413 malformed (OCPI 2001). 401 no known token. 429 + `Retry-After` over 60 requests a minute. Hardware refusals, such as an offline bay or a car on the sensor, come back as HTTP 200, `status_code` 1000, REJECTED, with the hardware's reason in `message` (internal paths, the API key and serial-like hex runs removed). Only timeouts and dropped connections get the generic 502 (OCPI 3000). Internal errors are 500. The same `reservation_id` again is an idempotent retry. |
| `POST /ocpi/2.2.1/commands/CANCEL_RESERVATION` | Partner | `{reservation_id, response_url?}` | ACCEPTED, with the cancellation fee in `ecurious_fee_cents`. REJECTED for an unknown id (including other partners' ids), a driver who has already checked in, or a reservation that has already ended. |
| `POST /ocpi/2.2.1/commands/{other}` | Partner | – | `NOT_SUPPORTED` |
| `GET /api/partner/v1/reservations/{reservation_id}` | Partner | – | `{reservation_id, location_id, evse_uid, status, arrive_by, session_end, bay_blocked, license_plate_hint, checked_in_at, ended_at, fees: {currency, reservation_cents, prepaid, total_cents, lines}}`. `status` is one of RESERVED, ARRIVED, CHARGING, COMPLETED, CANCELLED or NO_SHOW. 404 when the id is unknown or belongs to another partner. |
| `GET /bay/{location_id}` | Public | – | A shareable page with live availability, price, Directions, and one button (sign-in first if needed): "Reserve this bay" when the bay is free, or "Open in the app" when it isn't. An offline bay shows "Offline" and offers no reservation. It has OpenGraph and Twitter tags for link previews. 404 for other ids. |
| `GET /explore?bay={location_id}&reserve=1` | Driver | – | The app's map on the bay, with the reserve dialog open |
| `GET /openapi.json` | Public | – | The OpenAPI 3.1 spec of the public and partner routes |

## External calls we make

| Service | From | When | Call | Notes |
|---|---|---|---|---|
| **GoingElectric** | Server ([goingelectric.ts](../web/lib/goingelectric.ts)) | The Explore map moves (no cache), and the landing page renders (cached 6 h) | `GET https://api.goingelectric.de/chargepoints/?key…&sw_lat…` or `&lat&lng&radius` | Key server-side only. 8 s timeout. Up to 500 locations per call (`startkey` means more, flagged as `more`). [API docs](https://www.goingelectric.de/stromtankstellen/api/docs/) |
| **Ecurious server, REST** | Server ([ecurious.ts](../web/lib/ecurious.ts)) | Live mode only (the key **and** `ECURIOUS_LIVE=1`): reserve, release, status | `https://parking-lock-service-production.up.railway.app/api/v1`:<br>• `GET /locks`: our bays.<br>• `GET /locks/:id`: status, at most every 5 s.<br>• `POST /locks/:id/lock` and `/unlock` with `{cancelAutoLift: true}`.<br>• `POST /locks/:id/whitelist {plates}`. | The key goes in the `X-API-Key` header only. Timeouts: 5 s for reads, 8 s for commands. Reads retry twice; commands never do, with a 30 s cooldown after a failure. The reads are verified; the arm commands are phase 2. [Mapping](hardware-integration.md#how-the-app-maps-onto-the-hardware) |
| **Ecurious server, events** | Server ([ecurious-events.ts](../web/lib/ecurious-events.ts), through the bridge) | Live mode: one connection per server, started by `instrumentation.ts` | `GET /api/v1/events` (SSE): `lock:photo_captured`, `lock:car_presence`, `lock:status_change`, `lock:heartbeat`, `connected` | No `id:` lines, so nothing is replayed after a reconnect, which is why `status()` also reads over REST. Reconnect backoff from 1 s to 30 s, with a 60 s silence watchdog. [Events](hardware-integration.md#the-live-events) |
| **Clerk** | Browser and server | Every request (`auth()`), operator check (`currentUser()`), cars (`users.getUser`, `users.replaceUserMetadata`) | Clerk SDK | Sign-in and sign-up components, `UserButton`. Accountless dev keys until the app is claimed. |
| **Resend** | Server ([notify.ts](../web/lib/notify.ts)) | A new blocked-bay alert | `POST https://api.resend.com/emails` | 5 s timeout, never throws, no plate in the email. Skipped without `RESEND_API_KEY` or `OPERATOR_EMAILS`. |
| **Partner apps** | – | **Never** | – | We don't call `response_url` or any other URL a partner sends (SSRF). Partners poll the status route instead. |
| **Nominatim** (OSM) | Browser ([explore.tsx](../web/components/explore/explore.tsx)) | The driver submits a search | `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=…` | On submit only, as its usage policy forbids autocomplete |
| **OpenFreeMap** | Browser (MapLibre) | The map loads or moves | Style `https://tiles.openfreemap.org/styles/positron` plus vector tiles | No key. Attribution is shown automatically. |
| **Google Maps** | Browser | The driver taps Navigate or Directions | A link to `google.com/maps/dir/?api=1&destination=lat,lng` | A link only, no API key |
| **Browser APIs** | Browser | Locate me, "I'm at the bay", session reminders | Geolocation and Notification | Location is sent only for the fallback check-in, and not stored |
