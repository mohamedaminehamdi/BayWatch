# API calls

_Last updated: 2026-10-24. Fields marked **(being wired)** are in the engine ([reservation.ts](../web/lib/reservation.ts)) but not yet passed through by the route or UI. Partner developers should read [api.md](api.md), the integration guide for other charging apps (in progress)._

## Conventions

- JSON in and out. Errors come back as `{"error": "…"}` with a matching HTTP status:
  - 400 invalid input;
  - 401 signed out or a bad secret;
  - 402 payment not confirmed;
  - 403 not yours, or not an operator;
  - 404 not found, or a disabled demo route;
  - 409 wrong state or bay busy;
  - 413 body over 10 KB;
  - 502 hardware or GoingElectric failure.
- **Auth types:**
  - **Public:** no auth.
  - **Driver:** a Clerk session (cookie in the web app; a Bearer session token later for Flutter).
  - **Owner:** a driver who made this reservation.
  - **Operator:** a driver whose email is in `OPERATOR_EMAILS`.
  - **Secret:** the `x-webhook-secret` header.
- **CORS** on `/api/*`: any origin; methods `GET, POST, OPTIONS`; headers `content-type, authorization`.
- Money is integer euro cents, and times are ms timestamps.

## Our routes

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/state` | Public (personalised when signed in) | – | `bay` (name, address, lat, lng, powerKw), `holdMinutes`, `simulator`, `hardware` {state, mock}, `reservation`, `blockedSince`, `waiting`, `priority` {until, mine}, `quote` {type, cents, demand, multiplier, prepaid, warning, noShowCents}, `log`. Other drivers see `reservation` only as {id, status, expiresAt, end, mine: false}. The owner also gets times, fees, `charges`, `totalCents`, check-in method and a masked plate (`plateHint`). |
| `GET /api/chargers?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]` | Public | Map bounds, plus optional whole kW | `{chargers: [{id, name, lat, lng, address, network, points: [{count, power, type}], fault, url}], more?, warning?}`. 400 on bad bounds or `min_power`, 502 if GoingElectric fails. Without a key: an empty list plus a `warning`. |
| `POST /api/reservations` | Driver | `{vehicleId, payment: "demo"}` plus `durationMs`, `expectedCents` **(being wired)** | The owner's reservation view. 402 without `payment`, 404 unknown car, 400 invalid slot. 409 for: bay reserved, car in bay, held for a waiting driver, or "the price is now €X" when demand moved. 502 if the hardware fails (rolled back). |
| `POST /api/reservation/{action}` | Owner | See the actions table below | The owner's reservation view. 403 not yours, 404 unknown action, 409 wrong state |
| `GET /api/bookings` | Driver | – | The driver's own ended reservations (owner views, plates erased) |
| `GET /api/vehicles` | Driver | – | `[{id, plate, display, label, consentAt}]` |
| `POST /api/vehicles` | Driver | `{plate, label?, consent: true}` | The new car. 400 for no consent, a bad plate or a label over 30 characters. 409 for a duplicate or more than 5 cars. |
| `DELETE /api/vehicles/{id}` | Driver | – | `{ok: true}`, or 404 |
| `POST /api/waitlist` | Driver | – | `{position}`. 409 if the bay is free, already yours, or held for you. |
| `DELETE /api/waitlist` | Driver | – | `{ok: true}`. Leaving while you hold the priority window passes it on. |
| `POST /api/plate-events` | Secret | `{plate, direction?: "in" \| "out"}`. An empty plate means "unreadable". | `{matched, matchedBy?: "exact" \| "fuzzy"}`. 401 bad or missing secret, which also covers an unset `WEBHOOK_SECRET`. 400 bad `direction`. |
| `POST /api/sim/plate-events` | Driver + `SIMULATOR=1` | Same as above | Same. 404 when the simulator is off. |
| `GET /api/operator` | Operator | – | `bay`, `simulator`, `hardware`, the live `reservation` (public view), `blockedSince`, `alerts` (with the plate until resolved), `log`, `stats` (7-day `days[]` + `kpis`) |
| `POST /api/operator/alerts/{id}/resolve` | Operator | – | The resolved alert. The driver's hold resumes and the plate is erased. 404 unknown, 409 already resolved. |
| `POST /api/operator/simulate` | Operator + `SIMULATOR=1` | – | `{bookings, incidents}`. Replaces earlier simulated data. |
| Demo "site demand" control | Driver + `SIMULATOR=1` | quiet / normal / busy / full | **(being wired)**: sets the occupancy that drives the reservation price (`setOccupancy`) |
| `POST /ocpi/2.2.1/commands/{RESERVE_NOW \| CANCEL_RESERVATION}` | Partner token | OCPI ReserveNow / CancelReservation + `ecurious_license_plate` | **In progress**, see [api.md](api.md) |

### Actions on `POST /api/reservation/{action}`

| Action | Body | Allowed when | Effect |
|---|---|---|---|
| `cancel` | – | `reserved` | Releases the bay. Refunds everything except the cancellation fee, and it's free within 2 min or while the bay is blocked. |
| `extend` | – | `reserved`, once | +5 min on the arrival deadline, for €0.50 |
| `checkin` | `{lat, lng}` | `reserved`, within 150 m, no other car in the bay | Fallback check-in: releases the bay with `checkInMethod: "fallback"`. The coordinates aren't kept. |
| `other-plate` | `{plate, consent: true}` | `reserved` | "Different car today": the camera also accepts this plate, which is erased at the end |
| `charge` | – | `arrived` | `status: charging` |
| `finish` | – | `arrived` or `charging` | Ends the session. Adds an overstay fee if past the session end plus 15 min. |

## External calls we make

| Service | From | When | Call | Notes |
|---|---|---|---|---|
| **GoingElectric** | Server ([goingelectric.ts](../web/lib/goingelectric.ts)) | The Explore map moves (no cache), and the landing page renders (cached 6 h) | `GET https://api.goingelectric.de/chargepoints/?key…&sw_lat…` or `&lat&lng&radius` | Key server-side only. 8 s timeout. Up to 500 locations per call (`startkey` means more, flagged as `more`). [API docs](https://www.goingelectric.de/stromtankstellen/api/docs/) |
| **Ecurious server** | Server ([ecurious.ts](../web/lib/ecurious.ts)) | reserve, release, status | **Mock today** | On site: replace the three function bodies with HTTP calls, authenticated with `ECURIOUS_API_KEY`. Map the camera's events onto `POST /api/plate-events` `{plate, direction}`. |
| **Clerk** | Browser and server | Every request (`auth()`), operator check (`currentUser()`), cars (`users.getUser`, `users.replaceUserMetadata`) | Clerk SDK | Sign-in and sign-up components, `UserButton`. Accountless dev keys until the app is claimed. |
| **Resend** | Server ([notify.ts](../web/lib/notify.ts)) | A new blocked-bay alert | `POST https://api.resend.com/emails` | 5 s timeout, never throws, no plate in the email. Skipped without `RESEND_API_KEY` or `OPERATOR_EMAILS`. |
| **Nominatim** (OSM) | Browser ([explore.tsx](../web/components/explore/explore.tsx)) | The driver submits a search | `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=…` | On submit only, as its usage policy forbids autocomplete |
| **OpenFreeMap** | Browser (MapLibre) | The map loads or moves | Style `https://tiles.openfreemap.org/styles/positron` plus vector tiles | No key. Attribution is shown automatically. |
| **Google Maps** | Browser | The driver taps Navigate | A link to `google.com/maps/dir/?api=1&destination=lat,lng` | A link only, no API key |
| **Browser APIs** | Browser | Locate me, "I'm at the bay", reminders | Geolocation and Notification | Location is sent only for the fallback check-in, and not stored |
