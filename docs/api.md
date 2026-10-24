# Baywatch partner API

Let drivers in **your** charging app book a bay through Baywatch: one of the three Baywatch bays, guarded by an Ecurious lock, or any public charger GoingElectric lists. You send an OCPI 2.2.1 `RESERVE_NOW` with the slot and the driver's license plate. When the slot starts, the guard is up; when the car arrives, the bay camera reads its plate and lowers it. Your driver doesn't need a Baywatch account or app.

| | |
| --- | --- |
| Base URL | The Baywatch server, e.g. `http://localhost:3000` in development |
| Auth | `Authorization: Token <token>`, one token per partner app ([details](#auth-and-tokens)) |
| Format | JSON in the OCPI envelope `{ data, status_code, status_message, timestamp }` |
| Spec | OpenAPI 3.1: [`web/public/openapi.json`](../web/public/openapi.json), served at `GET /openapi.json` |
| Bays | `location_id` is the bay id: **`bw-1`**, **`bw-2`**, **`bw-3`** (the Baywatch bays) or **`ge-<id>`** (a GoingElectric charger). `evse_uid` is the bay id plus `-1`. |
| Slots | Starts on the quarter hour (:00, :15, :30, :45, Berlin time), whole 15-minute blocks, up to 60 days ahead |
| Status | Prototype, state in memory. bw-1 and bw-2 run on real Ecurious locks when the server is live; bw-3 and GoingElectric chargers have a simulated guard. Commands, status polling, the bay page and the deep link work. Callbacks, billing and hub connections are planned. |

## Quickstart

Four calls: quote, book, poll, cancel. These ran against a local server on 24 Oct 2026; the output is pretty-printed.

```bash
export BW=http://localhost:3000   # the Baywatch server
export TOKEN=...                  # your partner token
```

**1. Quote the slot** the driver picked, and show them `cents`: the fee depends on the bay's class and the demand at the start time, and is fixed once booked. `valid: false` comes with a `reason`. `cancelSchedule` says what cancelling costs from when on; not turning up costs the whole fee.

```bash
curl -s "$BW/api/bays/bw-1/quote?start=1792852200000&blocks=4"
```

```json
{
  "bayId": "bw-1",
  "start": 1792852200000,
  "end": 1792855800000,
  "blocks": 4,
  "class": "fast",
  "cents": 500,
  "demand": "Normal",
  "multiplier": 1,
  "creditAppliedCents": 0,
  "payCents": 500,
  "noShowCents": 500,
  "cancelSchedule": [
    { "from": 1792849455462, "percent": 0, "cents": 0 },
    { "from": 1792849575463, "percent": 10, "cents": 50 },
    { "from": 1792850400001, "percent": 50, "cents": 250 },
    { "from": 1792851900001, "percent": 80, "cents": 400 }
  ],
  "valid": true
}
```

**2. Book**, once the driver has accepted the price and plate recognition. Set `expiry_date` to any future time.

```bash
curl -s -X POST $BW/ocpi/2.2.1/commands/RESERVE_NOW \
  -H "Authorization: Token $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "response_url": "https://emsp.example/ocpi/2.2.1/commands/RESERVE_NOW/R-1001",
    "token": { "country_code": "DE", "party_id": "ACM", "uid": "drv-4711", "type": "APP_USER",
               "contract_id": "DE-ACM-C00004711-3", "issuer": "Acme Charge", "valid": true },
    "expiry_date": "2026-10-24T15:30:00.000Z",
    "reservation_id": "R-1001",
    "location_id": "bw-1",
    "evse_uid": "bw-1-1",
    "ecurious_license_plate": "M-AB 1234",
    "ecurious_plate_consent": true,
    "ecurious_start": 1792852200000,
    "ecurious_blocks": 4,
    "ecurious_fee_cents": 500
  }'
```

```json
{
  "data": {
    "result": "ACCEPTED",
    "timeout": 0,
    "message": [{ "language": "en", "text": "Booked. Arrive by 2026-10-24T14:45:00.000Z: the camera checks the car in by its plate." }],
    "ecurious_start": 1792852200000,
    "ecurious_end": 1792855800000,
    "ecurious_arrive_by": "2026-10-24T14:45:00.000Z",
    "ecurious_fee_cents": 500
  },
  "status_code": 1000,
  "status_message": "Success",
  "timestamp": "2026-10-24T13:44:15.570Z"
}
```

**3. Poll the status** every 10 to 30 seconds while the booking is live (from 30 min before the start).

```bash
curl -s $BW/api/partner/v1/reservations/R-1001 -H "Authorization: Token $TOKEN"
```

```json
{
  "data": {
    "reservation_id": "R-1001",
    "location_id": "bw-1",
    "evse_uid": "bw-1-1",
    "status": "UPCOMING",
    "session_start": "2026-10-24T14:30:00.000Z",
    "session_end": "2026-10-24T15:30:00.000Z",
    "arrive_by": "2026-10-24T14:45:00.000Z",
    "bay_blocked": false,
    "license_plate_hint": "MA•••34",
    "checked_in_at": null,
    "ended_at": null,
    "fees": {
      "currency": "EUR", "reservation_cents": 500, "total_cents": 500,
      "lines": [{ "label": "Reservation · Fast (DC) · normal demand", "cents": 500 }]
    }
  },
  "status_code": 1000,
  "status_message": "Success",
  "timestamp": "2026-10-24T13:44:15.589Z"
}
```

**4. Cancel**, possible while the status is `UPCOMING` or `LIVE`. It's free in the first 2 minutes after booking and a day or more ahead; see the fees [below](#booking-lifecycle).

```bash
curl -s -X POST $BW/ocpi/2.2.1/commands/CANCEL_RESERVATION \
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
  "timestamp": "2026-10-24T13:44:15.621Z"
}
```

Polling again now gives `"status": "CANCELLED"`, `"license_plate_hint": null` (the plate is erased), and a line `Refund: cancelled within 2 min of booking` that brings `total_cents` to 0.

## Auth and tokens

- **Getting a token:** ask the Baywatch team. We sign the [data processing agreement](#gdpr-and-the-data-processing-agreement) with you, then send you a token over a secure channel. One token per app and environment.
- **Sending it:** `Authorization: Token <token>`. OCPI 2.2.1 Base64-encodes the token in this header, and many OCPI 2.1/2.2 clients send it plain. We accept both.
- **Keep it on your server.** It books bays that you pay for. Never ship it in a mobile app or a web page.
- **How we check it:** the token is compared with every configured token as SHA-256 digests with `timingSafeEqual`, so response times reveal nothing about the tokens. A missing or unknown token gets `401` with `WWW-Authenticate: Token`. If no partner is configured, every request gets `401`: the check fails closed.
- **Server setup (Baywatch side):** `OCPI_PARTNER_TOKENS=acme:<token>,beta:<token>` in the server's environment. Use a lowercase name and a token of at least 32 characters, e.g. from `openssl rand -hex 32`; other entries are skipped with a warning in the log. To rotate a token, list the name twice (old and new token), then remove the old one. To revoke one, remove it. Both need a server restart.

## Endpoints

| Method and path | Auth | What it does |
| --- | --- | --- |
| `GET /api/bays?sw_lat&sw_lng&ne_lat&ne_lng[&min_power]` | none | `{ bays, realBays }`: the GoingElectric chargers in a map area, and the Baywatch bays always. Each with its class, status, LED and `priceFromCents`. |
| `GET /api/bays/{id}` | none | One bay, plus `today`: its 15-minute blocks |
| `GET /api/bays/{id}/availability?date=YYYY-MM-DD` | none | A day's blocks: `free`, `booked`, `gap` (too close to a booking), `past`. 96 a day; 92 or 100 on the daylight-saving days. |
| `GET /api/bays/{id}/quote?start=<ms>&blocks=<n>` | none | The fee and whether the slot can be booked ([step 1](#quickstart)). `?start=now` quotes "Book now": from the 15-minute block under way, for at least an hour from this moment (`blocks` ignored); the answer's `start` and `end` say what that is. |
| `POST /ocpi/2.2.1/commands/RESERVE_NOW` | Token | Book a slot for your driver ([fields](#reserve_now-fields)) |
| `POST /ocpi/2.2.1/commands/CANCEL_RESERVATION` | Token | `{ reservation_id }`: cancel one of **your** bookings while it's `UPCOMING` or `LIVE` |
| `POST /ocpi/2.2.1/commands/{other}` | Token | `NOT_SUPPORTED` |
| `GET /api/partner/v1/reservations/{reservation_id}` | Token | Status, slot, arrival deadline and fees of one of your bookings |
| `GET /bay/{location_id}` | none | Public web page for the bay ([deep links](#deep-links)) |
| `GET /explore?bay={location_id}&reserve=1` | Baywatch account | The app's map, opened on the bay with the booking dialog |
| `POST /api/plate-events` | Baywatch-internal | Events from other camera sources. Partners never call this. |
| `GET /api/config` | Baywatch-internal | The server's public settings for the Baywatch Flutter app: `{clerkPublishableKey, vapi}`, its `NEXT_PUBLIC_*` values only. Partners don't need it. |

## RESERVE_NOW fields

OCPI 2.2.1 `ReserveNow`, plus fields with the `ecurious_` prefix. Ids are OCPI `CiString(36)`: 1 to 36 printable ASCII characters, no spaces, compared case-insensitively.

| Field | Required | Notes |
| --- | :-: | --- |
| `token.uid` | yes | Your stable, opaque id for the driver (not an email). The booking's owner: at most 3 upcoming bookings per uid. |
| `token.type` | yes | `AD_HOC_USER`, `APP_USER`, `OTHER` or `RFID` |
| `token.contract_id` | yes | Checked, not stored |
| `token.valid` | no | `false` is REJECTED. Other Token fields are accepted and ignored. |
| `reservation_id` | yes | Your id for this booking, unique per booking. Sending it again while the booking is active returns ACCEPTED and changes nothing, so retries are safe. Once the booking has ended, the id can't be reused. |
| `location_id` | yes | The bay id: `bw-1`, `bw-2`, `bw-3`, or `ge-<id>` from `GET /api/bays`. Anything else is REJECTED. |
| `evse_uid` | no | If sent: the bay id plus `-1`, e.g. `bw-1-1` |
| `expiry_date` | yes | RFC 3339, in the future. The arrival deadline is `ecurious_arrive_by` in the answer (start + 15 min), whatever `expiry_date` says. |
| `response_url` | no | Accepted for OCPI compatibility and never called. Poll the status instead. |
| `authorization_reference` | no | Accepted and ignored |
| **`ecurious_license_plate`** | yes | The plate the camera will read. Spaces and dashes don't matter: 2 to 10 letters and digits. |
| **`ecurious_plate_consent`** | yes | Must be `true`: you confirm the driver agreed to plate recognition for this booking |
| **`ecurious_start`** | no | The start in ms, on the quarter hour (Berlin time), at most 60 days ahead. Default: the current block if it began under 5 minutes ago, else the next one. |
| **`ecurious_blocks`** | no | The length in 15-minute blocks, up to the bay's class: 16 (4 h) on slow, 8 (2 h) on fast, 4 (1 h) on ultra-fast bays. Default: that maximum. |
| **`ecurious_fee_cents`** | yes | The fee the driver accepted: `cents` from the [quote](#quickstart). If the price has moved since, you get REJECTED with the new price: show it and try again. |

`ecurious_session_minutes` (v1) was replaced by `ecurious_blocks`: sending it is a 400.

## Booking lifecycle

```text
RESERVE_NOW ─▶ UPCOMING ─(start − 30 min)─▶ LIVE ──camera reads the plate──▶ ARRIVED ──car leaves──▶ COMPLETED
                   │                          │            (guard lowers)
                   └── CANCEL_RESERVATION ────┴──▶ CANCELLED
                                              └── arrive_by passes ──▶ NO_SHOW
```

| Status | Meaning for your driver | Fees (invoiced to you) |
| --- | --- | --- |
| `UPCOMING` | Booked, more than 30 min before the start | The reservation fee, fixed at booking: €5 × the class (slow 0.5×, fast 1×, ultra-fast 1.5×) × the demand at the start (quiet 0.8×, normal 1×, busy 1.5×), never above €10. At normal demand: slow €2.50, fast €5, ultra-fast €7.50 |
| `LIVE` | From 30 min before the start until the car arrives. The guard is up from 10 min before. If `bay_blocked` is true, another car is in the bay: the arrival deadline waits, the operator is alerted, and cancelling is free. | |
| `ARRIVED` | Checked in by the camera, the guard is down: plug in | |
| `CHARGING` | Reported once the charger is connected. In the prototype the charger isn't connected, so partner bookings go from `ARRIVED` straight to `COMPLETED`. | |
| `COMPLETED` | The car has left | Idle fee from `session_end` + 5 min: €0.30 a started minute, at most €12 |
| `CANCELLED` | Cancelled before arrival | Free within 2 min of booking, 24 h or more before the start, or while the bay is blocked. Otherwise 10% of the fee from 24 h before, 50% from 30 min before, 80% from 5 min before until the arrival deadline. |
| `NO_SHOW` | Nobody arrived by `arrive_by` (start + 15 min) | The whole fee |

`fees.total_cents` is always the current amount for the booking, refunds and idle fees included.

## How the driver is recognised on site

The plate is the shared key between your app and our bay. The driver needs nothing from us: no account, no app, no QR code.

1. Your app collects the plate and the driver's consent, and sends both with `RESERVE_NOW`.
2. The plate is stored only on that booking. Partner bookings are owned by `partner:<your name>:<token.uid>`, so they never mix with other drivers'.
3. On a Baywatch bay with an Ecurious lock, the booked plate also goes on the lock camera's own list when the guard rises, so the camera can lower it for that car by itself. The list is emptied as soon as the car is checked in, or the booking is cancelled or missed.
4. Each car the camera sees is compared **only with the live booking of that bay**. Matching tolerates common misreads (O/0, B/8, one wrong character on plates of 6+ characters).
5. If the plate matches, the guard lowers and the status turns `ARRIVED`. When the car leaves (the bay's sensor reads vacant for 10 s), the status turns `COMPLETED`, the plate is erased, and the guard rises again.

**Known gaps for partner drivers.** Our own app can check a driver in by location when the camera can't read the plate, and can add a second plate when they arrive in a different car. Neither is in the partner API yet. Until then, if the camera can't read the plate, the guard stays up and the driver needs the operator to open the bay. To change the plate, your app cancels and books again.

## Deep links

| Link | Use it for |
| --- | --- |
| `https://<baywatch-host>/bay/bw-1` | A public page for the bay, with its live availability and price and one way in. It has OpenGraph and Twitter tags, so it previews well in chats. Link here from apps that don't integrate the API, or when sharing a bay. |
| `https://<baywatch-host>/explore?bay=bw-1&reserve=1` | Opens the Baywatch app on the bay with the booking dialog. Signed-out visitors sign in first and come straight back to it. |

A **"Book with Baywatch"** button in your app is a plain link to the bay page. Open it in the system browser, not a WebView, so sign-in and a future native app work:

```html
<a href="https://<baywatch-host>/bay/bw-1">Book with Baywatch</a>
```

**Native app (planned).** These HTTPS URLs stay the contract. A native Baywatch app would claim them as iOS universal links (`/.well-known/apple-app-site-association` listing `/bay/*` and `/explore`) and Android App Links (`/.well-known/assetlinks.json` plus `autoVerify` intent filters). With the app installed, the link opens it; without it, the same link opens the web page. Partners change nothing.

## Errors

Every partner answer uses the OCPI envelope. A command that was processed but refused is still HTTP 200 and `status_code` 1000, with `result: REJECTED` and the reason in `message`.

| Situation | HTTP | `status_code` | `data.result` | Example message |
| --- | :-: | :-: | --- | --- |
| Booked or cancelled | 200 | 1000 | `ACCEPTED` | `Booked. Arrive by …` |
| Slot taken (with the 10-min gap), the token's 3-booking limit | 200 | 1000 | `REJECTED` | `Taken: this slot overlaps another booking or its 10-minute gap` |
| Wrong `location_id` or `evse_uid` | 200 | 1000 | `REJECTED` | `Unknown location_id: use a Baywatch bay (bw-1, bw-2, bw-3) or a GoingElectric charger (ge-<id>)` |
| Price moved since the driver saw it | 200 | 1000 | `REJECTED` | `The price is now €7.50. Check it and book again.` |
| Not your booking, already checked in or ended, id reused | 200 | 1000 | `REJECTED` | `Unknown reservation_id` |
| `token.valid` false, `expiry_date` passed | 200 | 1000 | `REJECTED` | `expiry_date has already passed` |
| The bay's hardware said no: a car over the arm, the lock offline, a command that just failed (nothing was booked or cancelled) | 200 | 1000 | `REJECTED` | `The bay could not be reserved: A car is over the arm, so it was not raised` |
| Command other than the two | 200 | 1000 | `NOT_SUPPORTED` | |
| A field missing or invalid, a slot off the grid or too long, bad JSON | 400 | 2001 | `REJECTED` | `Fast (DC) bays take bookings of up to 2 h` |
| Body over 10 KB | 413 | 2001 | `REJECTED` | `Request body too large` |
| Missing or unknown token | 401 | 2000 | | `Missing or unknown token` |
| Status of a booking that isn't yours | 404 | 2000 | | `Unknown reservation_id` |
| Over the rate limit | 429 | 2000 | | `Too many requests. Try again in 49 s.` (and a `Retry-After` header) |
| The bay's hardware didn't answer: a timeout or a dropped connection (nothing was booked or cancelled) | 502 | 3000 | `REJECTED` | `The bay’s hardware did not respond. Try again in a minute.` |
| Our bug | 500 | 3000 | `REJECTED` | `Internal error` |

**Retries:** retry 429, 500 and 502 with backoff, re-sending the **same** `reservation_id` (that's safe). Don't retry a 400 or a REJECTED unchanged; a hardware REJECTED says when it's worth trying again (`try again in 20 s`), and an offline lock or a car over the arm won't change in seconds. Internal details (our REST paths, keys, device serials) never appear in messages: we log them on our side.

## Limits and abuse

- **60 requests a minute per partner**, commands and status polls together. Past that: `429` with `Retry-After`.
- **Request bodies up to 10 KB.** Every field is validated before anything reaches the bay.
- **Holding bays costs money:** at most 3 upcoming bookings per `token.uid`; cancelling costs from 24 h before the start (after the first 2 minutes); a no-show costs the whole fee.
- **Isolation:** each partner sees and cancels only its own bookings; another partner's `reservation_id` answers as unknown.
- **No outbound requests:** we never call `response_url` or any other URL a partner sends, so the API can't be used to reach internal networks (SSRF).
- *Planned:* the limits move to the API gateway when there's more than one server instance, along with per-IP limits for unauthenticated traffic.

## GDPR and the data processing agreement

You send personal data about your driver, so **a data processing agreement (GDPR Art. 28) is needed before going live**. It fixes the purpose (matching the plate to this booking), retention (below) and sub-processors (hosting, and the Ecurious lock service behind the Baywatch bays).

**Your side:** before booking, explain plate recognition to the driver and get their consent; only then send `ecurious_plate_consent: true`. Tell them the plate is deleted after the session. If they withdraw consent before arriving, cancel the booking: that erases the plate at once.

**Our side:**

| Data | Why | How long |
| --- | --- | --- |
| License plate | To match the camera read to this booking | Until the booking ends (completed, cancelled, no-show), then erased. On an Ecurious lock's camera, only from when the guard rises until the car is checked in (or the booking ends). Status answers only ever show `MA•••34`. |
| `ecurious_plate_consent` | Proof that you asked | Checked, not stored |
| `token.uid` | Owner of the booking: the 3-booking limit | With the booking record |
| `reservation_id` | Your handle for status and cancel | With the booking record (the last 500) |
| `token.contract_id` and other Token fields, `response_url` | OCPI validation | Checked, not stored |

- Plates of other cars the camera sees aren't stored. The exception is a car blocking a booked bay: its plate goes to the operator alert and is erased once the incident is resolved.
- The event log never contains plates.
- In the prototype everything is in memory, on one server, and gone after a restart.

## Roaming outlook

**OCPI hubs (e.g. GIREVE).** The two commands already follow the OCPI 2.2.1 Commands module. To connect through a hub, we would add four things:

- the Versions and Credentials handshake, replacing hand-issued tokens;
- Locations, publishing the Baywatch bays with a reservable EVSE each;
- Tariffs and CDRs for the reservation and no-show fees;
- `CommandResult` callbacks, sent only to the `response_url` hosts a partner registered during the handshake.

Hubs may drop unknown fields such as `ecurious_license_plate`. Until a shared booking standard carries the plate, hub partners would send it to us directly (a planned call keyed by `token.uid`).

**Hubject's** network runs on its own protocol, OICP. Its `AuthorizeRemoteReservationStart` and `AuthorizeRemoteReservationStop` are the same two operations, so an OICP adapter would call the same functions in `web/lib/partners.ts`.

**OCPP: the plug as well as the bay.** The guard reserves the parking space. If the charger supports OCPP reservations, the CPO's backend forwards our booking to it, so the connector is reserved too:

| Baywatch | OCPP 1.6 | OCPP 2.0.1 |
| --- | --- | --- |
| `RESERVE_NOW` accepted | `ReserveNow` (`connectorId`, `expiryDate` = `arrive_by`, `idTag`, `reservationId`) | `ReserveNowRequest` (`id`, `expiryDateTime`, `idToken`, `evseId`) |
| `CANCEL_RESERVATION`, no-show | `CancelReservation` (`reservationId`) | `CancelReservationRequest` (`reservationId`) |
| REJECTED: car in the bay / hardware down | `Occupied` / `Faulted`, `Unavailable` | same statuses |
| `CHARGING`, `COMPLETED` | `StatusNotification` Charging, `StopTransaction` | `TransactionEvent` Started / Ended |

The transaction-end event would also close a booking when the camera misses the car leaving. Today a checked-in partner booking only ends when the camera sees the car leave.

**More bays and operators.** The API doesn't change shape:

- `location_id` is a bay today, and `evse_uid` its one guarded EVSE (`bw-1`, `bw-1-1`). With several bays at a site, `location_id` becomes the site and `evse_uid` picks a bay, or you omit it to get any free bay there.
- The server already keeps one schedule per bay; with a database, bookings, partner links, rate limits and tokens move out of memory.
- Several operators each get their own location ids under their OCPI `country_code` and `party_id`, on one multi-tenant server or one server each. The same partner token reaches all of them through a hub.

**Where we deviate from OCPI 2.2.1, on purpose:**

1. The CommandResponse is final: `timeout` is 0 and no `CommandResult` follows. Poll the status endpoint instead.
2. A repeated `reservation_id` is an idempotent retry, not OCPI's "replace". To change a booking, cancel it and book again.
3. Three `ecurious_` fields are required (plate, consent and the accepted fee), and two optional ones pick the slot (`ecurious_start`, `ecurious_blocks`).
4. The arrival deadline is always start + 15 min (`ecurious_arrive_by`), whatever `expiry_date` says.
5. There are no Versions or Credentials modules yet: tokens are issued by hand.
6. The status endpoint is our own, because OCPI 2.2.1 has no reservation object to read.

## Keeping this doc current

Update this file **and** `web/public/openapi.json` in the same change whenever any of these change:

- a request or response field, status code or error text in `web/lib/partners.ts`;
- a status, fee, grace period or slot rule in `web/lib/schedule.ts`, `web/lib/booking-rules.ts` or `web/lib/pricing.ts`;
- the bay endpoints partners read (`/api/bays`, `/api/bays/{id}`, `/availability`, `/quote`);
- an endpoint, environment variable or the deep-link format.

Then run `cd web && node --test lib/partners.test.ts`, re-run the [quickstart](#quickstart) against a dev server, and paste the new output here. Bump `info.version` in the OpenAPI file for any breaking change.
