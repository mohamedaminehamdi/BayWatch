# Ecurious Reserve partner API

Let drivers in **your** charging app reserve a bay that an Ecurious guard keeps free. You send an OCPI 2.2.1 `RESERVE_NOW` with the driver's license plate. The guard rises at once, and when the car arrives, the bay camera reads its plate and lowers the guard. Your driver doesn't need an Ecurious account or app.

| | |
| --- | --- |
| Base URL | The Ecurious Reserve server, e.g. `http://localhost:3000` in development |
| Auth | `Authorization: Token <token>`, one token per partner app ([details](#auth-and-tokens)) |
| Format | JSON in the OCPI envelope `{ data, status_code, status_message, timestamp }` |
| Spec | OpenAPI 3.1: [`web/public/openapi.json`](../web/public/openapi.json), served at `GET /openapi.json` |
| Bay today | `location_id` **`ECU-TEST-1`**, `evse_uid` **`ECU-TEST-1-1`**: one 200 kW DC bay |
| Status | Prototype: one bay, state in memory. The real Ecurious hardware client is built, but the bay runs on the mock until the live test at the bay. Commands, status polling, the bay page and the deep link work. Callbacks, billing and hub connections are planned. |

## Quickstart

Four calls: check, reserve, poll, cancel. These ran against a local server on 24 Oct 2026; the output is pretty-printed.

```bash
export ECU=http://localhost:3000   # the Ecurious Reserve server
export TOKEN=...                   # your partner token
```

**1. Is the bay free, and what does it cost right now?** It's free when `reservation`, `blockedSince` and `priority` are all `null`. Show `quote.cents` to the driver; demand can move it. (Output trimmed.)

```bash
curl -s $ECU/api/state
```

```json
{
  "bay": { "name": "Ecurious test bay", "address": "Hackathon venue", "lat": 52.52, "lng": 13.405, "powerKw": 200 },
  "session": { "type": "fast", "label": "Fast (DC)", "maxMinutes": 120, "presets": [30, 60, 90, 120] },
  "holdMinutes": 15,
  "reservation": null,
  "blockedSince": null,
  "priority": null,
  "quote": { "type": "fast", "cents": 250, "demand": "Normal", "multiplier": 1, "prepaid": false, "warning": null, "noShowCents": 125 },
  "…": "fields for the Ecurious app, ignore them"
}
```

**2. Reserve**, once the driver has accepted the price and plate recognition. Set `expiry_date` to any future time.

```bash
curl -s -X POST $ECU/ocpi/2.2.1/commands/RESERVE_NOW \
  -H "Authorization: Token $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "response_url": "https://emsp.example/ocpi/2.2.1/commands/RESERVE_NOW/R-1001",
    "token": { "country_code": "DE", "party_id": "ACM", "uid": "drv-4711", "type": "APP_USER",
               "contract_id": "DE-ACM-C00004711-3", "issuer": "Acme Charge", "valid": true,
               "whitelist": "ALLOWED", "last_updated": "2026-10-24T08:00:00Z" },
    "expiry_date": "2026-10-24T12:00:00Z",
    "reservation_id": "R-1001",
    "location_id": "ECU-TEST-1",
    "evse_uid": "ECU-TEST-1-1",
    "ecurious_license_plate": "M-AB 1234",
    "ecurious_plate_consent": true,
    "ecurious_session_minutes": 60,
    "ecurious_fee_cents": 250
  }'
```

```json
{
  "data": {
    "result": "ACCEPTED",
    "timeout": 0,
    "message": [{ "language": "en", "text": "Reserved. Arrive by 2026-10-24T11:32:44.647Z: the camera checks the car in by its plate." }],
    "ecurious_arrive_by": "2026-10-24T11:32:44.647Z",
    "ecurious_fee_cents": 250
  },
  "status_code": 1000,
  "status_message": "Success",
  "timestamp": "2026-10-24T11:17:44.647Z"
}
```

**3. Poll the status** every 10 to 30 seconds while the reservation is active.

```bash
curl -s $ECU/api/partner/v1/reservations/R-1001 -H "Authorization: Token $TOKEN"
```

```json
{
  "data": {
    "reservation_id": "R-1001",
    "location_id": "ECU-TEST-1",
    "evse_uid": "ECU-TEST-1-1",
    "status": "RESERVED",
    "arrive_by": "2026-10-24T11:32:44.647Z",
    "session_end": "2026-10-24T12:17:44.647Z",
    "bay_blocked": false,
    "license_plate_hint": "MA•••34",
    "checked_in_at": null,
    "ended_at": null,
    "fees": {
      "currency": "EUR", "reservation_cents": 250, "prepaid": false, "total_cents": 250,
      "lines": [{ "label": "Reservation · Fast (DC) · normal demand", "cents": 250 }]
    }
  },
  "status_code": 1000,
  "status_message": "Success",
  "timestamp": "2026-10-24T11:17:44.676Z"
}
```

**4. Cancel**, possible while the status is `RESERVED`. It's free in the first 2 minutes.

```bash
curl -s -X POST $ECU/ocpi/2.2.1/commands/CANCEL_RESERVATION \
  -H "Authorization: Token $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reservation_id": "R-1001"}'
```

```json
{
  "data": {
    "result": "ACCEPTED",
    "timeout": 0,
    "message": [{ "language": "en", "text": "Cancelled, the bay is free again. No fee." }],
    "ecurious_fee_cents": 0
  },
  "status_code": 1000,
  "status_message": "Success",
  "timestamp": "2026-10-24T11:17:44.712Z"
}
```

Polling again now gives `"status": "CANCELLED"`, `"license_plate_hint": null` (the plate is erased), and a refund line that brings `total_cents` to 0.

## Auth and tokens

- **Getting a token:** ask the Ecurious Reserve team. We sign the [data processing agreement](#gdpr-and-the-data-processing-agreement) with you, then send you a token over a secure channel. One token per app and environment.
- **Sending it:** `Authorization: Token <token>`. OCPI 2.2.1 Base64-encodes the token in this header, and many OCPI 2.1/2.2 clients send it plain. We accept both.
- **Keep it on your server.** It books bays that you pay for. Never ship it in a mobile app or a web page.
- **How we check it:** the token is compared with every configured token as SHA-256 digests with `timingSafeEqual`, so response times reveal nothing about the tokens. A missing or unknown token gets `401` with `WWW-Authenticate: Token`. If no partner is configured, every request gets `401`: the check fails closed.
- **Server setup (Ecurious side):** `OCPI_PARTNER_TOKENS=acme:<token>,beta:<token>` in the server's environment. Use a lowercase name and a token of at least 32 characters, e.g. from `openssl rand -hex 32`; other entries are skipped with a warning in the log. To rotate a token, list the name twice (old and new token), then remove the old one. To revoke one, remove it. Both need a server restart. `BAY_ID` sets the location id (default `ECU-TEST-1`).

## Endpoints

| Method and path | Auth | What it does |
| --- | --- | --- |
| `GET /api/state` | none | Bay, availability, price (`quote`), session lengths. Anonymous: no driver data. |
| `GET /api/chargers?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]` | none | Public chargers from GoingElectric in a map area. Info only, under GoingElectric's terms. |
| `POST /ocpi/2.2.1/commands/RESERVE_NOW` | Token | Reserve the bay for your driver ([fields](#reserve_now-fields)) |
| `POST /ocpi/2.2.1/commands/CANCEL_RESERVATION` | Token | `{ reservation_id }`: cancel one of **your** reservations while it's `RESERVED` |
| `POST /ocpi/2.2.1/commands/{other}` | Token | `NOT_SUPPORTED` |
| `GET /api/partner/v1/reservations/{reservation_id}` | Token | Status, arrival deadline and fees of one of your reservations |
| `GET /bay/{location_id}` | none | Public web page for the bay ([deep links](#deep-links)) |
| `GET /explore?bay={location_id}&reserve=1` | Ecurious account | The app's map, opened on the bay with the reserve dialog |
| `POST /api/plate-events` | Ecurious-internal | Camera events from the Ecurious server. Partners never call this. |

## RESERVE_NOW fields

OCPI 2.2.1 `ReserveNow`, plus fields with the `ecurious_` prefix. Ids are OCPI `CiString(36)`: 1 to 36 printable ASCII characters, no spaces, compared case-insensitively.

| Field | Required | Notes |
| --- | :-: | --- |
| `token.uid` | yes | Your stable, opaque id for the driver (not an email). The booking's owner: no-show history is kept per uid. |
| `token.type` | yes | `AD_HOC_USER`, `APP_USER`, `OTHER` or `RFID` |
| `token.contract_id` | yes | Checked, not stored |
| `token.valid` | no | `false` is REJECTED. Other Token fields are accepted and ignored. |
| `reservation_id` | yes | Your id for this reservation, unique per reservation. Sending it again while the reservation is active returns ACCEPTED and changes nothing, so retries are safe. Once the reservation has ended, the id can't be reused. |
| `location_id` | yes | `ECU-TEST-1`. Any other id is REJECTED. |
| `evse_uid` | no | If sent: `ECU-TEST-1-1` |
| `expiry_date` | yes | RFC 3339, in the future. The hold ends at `ecurious_arrive_by` in the answer (booking + 15 min), whatever `expiry_date` says. |
| `response_url` | no | Accepted for OCPI compatibility and never called. Poll the status instead. |
| `authorization_reference` | no | Accepted and ignored |
| **`ecurious_license_plate`** | yes | The plate the camera will read. Spaces and dashes don't matter: 2 to 10 letters and digits. |
| **`ecurious_plate_consent`** | yes | Must be `true`: you confirm the driver agreed to plate recognition for this booking |
| **`ecurious_session_minutes`** | yes | How long the driver wants to charge, counted from booking: 1 to `session.maxMinutes` (120 on this DC bay) |
| **`ecurious_fee_cents`** | yes | The fee the driver accepted, i.e. `quote.cents`. If demand has moved the price since, you get REJECTED with the new price: show it and try again. |

## Reservation lifecycle

```text
RESERVE_NOW ─▶ RESERVED ──camera reads the plate──▶ ARRIVED ──car leaves──▶ COMPLETED
                  │                         (guard lowers)
                  ├── CANCEL_RESERVATION ──▶ CANCELLED     (bay released)
                  └── arrive_by passes ────▶ NO_SHOW       (bay released)
```

| Status | Meaning for your driver | Fees (invoiced to you) |
| --- | --- | --- |
| `RESERVED` | The guard holds the bay until `arrive_by`. If `bay_blocked` is true, another car is parked there: the hold is paused, the operator alerted, and cancelling is free. | The reservation fee, fixed at booking: €2.50 for fast (DC), €1.50 for slow (AC) at normal demand, 0.8× to 2× with demand, never above €4.00 |
| `ARRIVED` | Checked in by the camera, the guard is down: plug in | |
| `CHARGING` | Reported once the charger is connected. In the prototype the charger isn't connected, so partner bookings go from `ARRIVED` straight to `COMPLETED`. | |
| `COMPLETED` | The car has left | Idle fee from `session_end` + 15 min: €0.25/min (DC) or €0.10/min (AC), at most €12 |
| `CANCELLED` | Released before arrival | Free in the first 2 min or while the bay is blocked; after that 60% of the no-show fee (€0.75 on €2.50) |
| `NO_SHOW` | Nobody arrived by `arrive_by`, so the bay was released | Half the fee (€1.25 on €2.50). After 3 no-shows in a token's last 10 bookings (90 days), `fees.prepaid` is true and the whole fee is kept. |

`fees.total_cents` is always the current amount for the booking, refunds included. The rules and their sources are in [reservation-model.md](reservation-model.md).

## How the driver is recognised on site

The plate is the shared key between your app and our bay. The driver needs nothing from us: no account, no app, no QR code.

1. Your app collects the plate and the driver's consent, and sends both with `RESERVE_NOW`.
2. The plate is stored only on that reservation. Partner bookings are owned by `partner:<your name>:<token.uid>`, so they never mix with other drivers'.
3. Each car the camera sees is compared **only with the one active booking**. Matching tolerates common misreads (O/0, B/8, one wrong character on plates of 6+ characters).
4. If the plate matches, the guard lowers and the status turns `ARRIVED`. Here is the internal camera webhook from our test run, then the partner's view:

```bash
curl -s -X POST $ECU/api/plate-events -H "x-webhook-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"plate":"MAB 1234","direction":"in"}'
# {"matched": true, "matchedBy": "exact"}
curl -s $ECU/api/partner/v1/reservations/R-2006 -H "Authorization: Token $TOKEN"
# … "status": "ARRIVED", "checked_in_at": "2026-10-24T11:17:57.341Z" …
```

When the camera sees the car leave, the status turns `COMPLETED` and the plate is erased.

**Known gaps for partner drivers.** Our own app can check a driver in by location when the camera can't read the plate, and can add a second plate when they arrive in a different car. Neither is in the partner API yet. Until then, if the camera can't read the plate, the guard stays up and the driver needs the operator to open the bay. To change the plate, your app cancels and books again.

## Deep links

| Link | Use it for |
| --- | --- |
| `https://<ecurious-host>/bay/ECU-TEST-1` | A public page with the bay's name, power, live availability and price, and one button: "Reserve this bay" when the bay is free, or "Open in the app" when it isn't. When the bay is offline, the page says so and offers no reservation. It has OpenGraph and Twitter tags, so it previews well in chats. Link here from apps that don't integrate the API, or when sharing a bay. |
| `https://<ecurious-host>/explore?bay=ECU-TEST-1&reserve=1` | Opens the Ecurious app on the bay with the reserve dialog. Signed-out visitors sign in first and come straight back to it. |

A **"Reserve with Ecurious"** button in your app is a plain link to the bay page. Open it in the system browser, not a WebView, so sign-in and a future native app work:

```html
<a href="https://<ecurious-host>/bay/ECU-TEST-1">Reserve with Ecurious</a>
```

**Native app (planned).** These HTTPS URLs stay the contract. A native Ecurious app would claim them as iOS universal links (`/.well-known/apple-app-site-association` listing `/bay/*` and `/explore`) and Android App Links (`/.well-known/assetlinks.json` plus `autoVerify` intent filters). With the app installed, the link opens it; without it, the same link opens the web page. Partners change nothing.

## Errors

Every partner answer uses the OCPI envelope. A command that was processed but refused is still HTTP 200 and `status_code` 1000, with `result: REJECTED` and the reason in `message`.

| Situation | HTTP | `status_code` | `data.result` | Example message |
| --- | :-: | :-: | --- | --- |
| Reserved or cancelled | 200 | 1000 | `ACCEPTED` | `Reserved. Arrive by …` |
| Bay taken, car in the bay, held for a waiting driver | 200 | 1000 | `REJECTED` | `Bay is already reserved` |
| Wrong `location_id` or `evse_uid` | 200 | 1000 | `REJECTED` | `Unknown location_id. This server has ECU-TEST-1.` |
| Price moved since the driver saw it | 200 | 1000 | `REJECTED` | `The price is now €3.75. Check it and reserve again.` |
| Not your reservation, already checked in or ended, id reused | 200 | 1000 | `REJECTED` | `Unknown reservation_id` |
| `token.valid` false, `expiry_date` passed | 200 | 1000 | `REJECTED` | `expiry_date has already passed` |
| The bay's hardware said no: a car over the arm, the bay offline, a command that just failed (nothing was booked or cancelled) | 200 | 1000 | `REJECTED` | `The bay could not be reserved: A car is over the arm, so it was not raised` |
| Command other than the two | 200 | 1000 | `NOT_SUPPORTED` | |
| A field missing or invalid, bad JSON | 400 | 2001 | `REJECTED` | `ecurious_license_plate is required: the plate the camera will read` |
| Body over 10 KB | 413 | 2001 | `REJECTED` | `Request body too large` |
| Missing or unknown token | 401 | 2000 | | `Missing or unknown token` |
| Status of a reservation that isn't yours | 404 | 2000 | | `Unknown reservation_id` |
| Over the rate limit | 429 | 2000 | | `Too many requests. Try again in 49 s.` (and a `Retry-After` header) |
| The bay's hardware didn't answer: a timeout or a dropped connection (nothing was booked or cancelled) | 502 | 3000 | `REJECTED` | `The bay’s hardware did not respond. Try again in a minute.` |
| Our bug | 500 | 3000 | `REJECTED` | `Internal error` |

**Retries:** retry 429, 500 and 502 with backoff, re-sending the **same** `reservation_id` (that's safe). Don't retry a 400 or a REJECTED unchanged; a hardware REJECTED says when it's worth trying again (`try again in 20 s`), and an offline bay or a car over the arm won't change in seconds. Internal details (our REST paths, keys, device serials) never appear in messages: we log them on our side.

## Limits and abuse

- **60 requests a minute per partner**, commands and status polls together. Past that: `429` with `Retry-After`.
- **Request bodies up to 10 KB.** Every field is validated before anything reaches the bay.
- **One active booking per bay, and holding it costs money:** cancelling after the first 2 minutes costs, no-shows cost half the fee, and repeat no-shows switch that token to prepaid. Chaining free 2-minute cancellations to keep the bay frozen isn't blocked yet (planned: a cap on free cancellations per partner and hour).
- **Isolation:** each partner sees and cancels only its own reservations; another partner's `reservation_id` answers as unknown.
- **No outbound requests:** we never call `response_url` or any other URL a partner sends, so the API can't be used to reach internal networks (SSRF).
- *Planned:* the limits move to the API gateway when there's more than one server instance, along with per-IP limits for unauthenticated traffic.

## GDPR and the data processing agreement

You send personal data about your driver, so **a data processing agreement (GDPR Art. 28) is needed before going live**. It fixes the purpose (matching the plate to this booking), retention (below) and sub-processors (hosting, the Ecurious server).

**Your side:** before booking, explain plate recognition to the driver and get their consent; only then send `ecurious_plate_consent: true`. Tell them the plate is deleted after the session. If they withdraw consent before arriving, cancel the booking: that erases the plate at once.

**Our side:**

| Data | Why | How long |
| --- | --- | --- |
| License plate | To match the camera read to this booking | Until the booking ends (completed, cancelled, no-show), then erased. Status answers only ever show `MA•••34`. |
| `ecurious_plate_consent` | Proof that you asked | Checked, not stored |
| `token.uid` | Owner of the booking: one booking at a time, no-show history | With the booking record. No-show outcomes count for 90 days. |
| `reservation_id` | Your handle for status and cancel | With the booking record (the last 500) |
| `token.contract_id` and other Token fields, `response_url` | OCPI validation | Checked, not stored |

- Plates of other cars the camera sees aren't stored. The exception is a car blocking a reserved bay: its plate goes to the operator alert and is erased once the incident is resolved.
- The event log never contains plates.
- In the prototype everything is in memory, on one server, and gone after a restart.

## Roaming outlook

**OCPI hubs (e.g. GIREVE).** The two commands already follow the OCPI 2.2.1 Commands module. To connect through a hub, we would add four things:

- the Versions and Credentials handshake, replacing hand-issued tokens;
- Locations, publishing `ECU-TEST-1` with a reservable EVSE;
- Tariffs and CDRs for the reservation and no-show fees;
- `CommandResult` callbacks, sent only to the `response_url` hosts a partner registered during the handshake.

Hubs may drop unknown fields such as `ecurious_license_plate`. Until a shared booking standard carries the plate, hub partners would send it to us directly (a planned call keyed by `token.uid`).

**Hubject's** network runs on its own protocol, OICP. Its `AuthorizeRemoteReservationStart` and `AuthorizeRemoteReservationStop` are the same two operations, so an OICP adapter would call the same functions in `web/lib/partners.ts`.

**OCPP: the plug as well as the bay.** The Ecurious guard reserves the parking space. If the charger supports OCPP reservations, the CPO's backend forwards our booking to it, so the connector is reserved too:

| Ecurious | OCPP 1.6 | OCPP 2.0.1 |
| --- | --- | --- |
| `RESERVE_NOW` accepted | `ReserveNow` (`connectorId`, `expiryDate` = `arrive_by`, `idTag`, `reservationId`) | `ReserveNowRequest` (`id`, `expiryDateTime`, `idToken`, `evseId`) |
| `CANCEL_RESERVATION`, no-show | `CancelReservation` (`reservationId`) | `CancelReservationRequest` (`reservationId`) |
| REJECTED: car in the bay / hardware down | `Occupied` / `Faulted`, `Unavailable` | same statuses |
| `CHARGING`, `COMPLETED` | `StatusNotification` Charging, `StopTransaction` | `TransactionEvent` Started / Ended |

The transaction-end event would also close a booking when the camera misses the car leaving. Today a checked-in partner booking only ends when the camera sees the car leave.

**More bays and operators.** The API doesn't change shape:

- `location_id` is a site, and `evse_uid` is a guarded bay at it. Today both are 1:1 (`ECU-TEST-1`, `ECU-TEST-1-1`). With several bays, `evse_uid` picks one, or you omit it to get any free bay at the site.
- The server keys state by `evse_uid`, and moves reservations, partner links, rate limits and tokens from memory into a database.
- Several operators each get their own location ids under their OCPI `country_code` and `party_id`, on one multi-tenant server or one server each. The same partner token reaches all of them through a hub.

**Where we deviate from OCPI 2.2.1, on purpose:**

1. The CommandResponse is final: `timeout` is 0 and no `CommandResult` follows. Poll the status endpoint instead.
2. A repeated `reservation_id` is an idempotent retry, not OCPI's "replace". To change a booking, cancel it and book again.
3. Four `ecurious_` fields are required: plate, consent, session length and the accepted fee.
4. The hold always lasts the house arrival grace (`ecurious_arrive_by`), whatever `expiry_date` says.
5. There are no Versions or Credentials modules yet: tokens are issued by hand.
6. The status endpoint is our own, because OCPI 2.2.1 has no reservation object to read.

## Keeping this doc current

Update this file **and** `web/public/openapi.json` in the same change whenever any of these change:

- a request or response field, status code or error text in `web/lib/partners.ts`;
- a status, fee, grace period or session limit in `web/lib/reservation.ts`, `web/lib/booking-rules.ts` or `web/lib/pricing.ts`;
- the `/api/state` fields partners read (`quote`, `session`, `reservation`, `blockedSince`, `priority`);
- an endpoint, environment variable or the deep-link format.

Then run `cd web && node --test lib/partners.test.ts`, re-run the [quickstart](#quickstart) against a dev server, and paste the new output here. Bump `info.version` in the OpenAPI file for any breaking change.
