# Ecurious Reserve

**Your charging spot, kept free.** A charging app for public EV charging that reserves a bay with Ecurious hardware and checks you in by license plate when you arrive. Built for the Ecurious challenge at the Watt the Hack hackathon.

**Status (2026-10-24):**
- **Built:**
  - the driver app (landing → sign-in → find → reserve → arrive → charge → receipt), with the full fee rules;
  - the operator dashboard, with a hardware panel;
  - the partner API for other charging apps;
  - the real hardware client for the Ecurious bay (REST calls plus live events), verified read-only.

  The full cycle runs end to end on the built-in **mock**. On the real bay, it waits for the supervised test that moves the arm ([phase 2](docs/hardware-integration.md#phase-2-the-live-test-at-the-bay)).
- **Look:** the UI uses the Ecurious brand from ecurious.com ([web/DESIGN.md](web/DESIGN.md)).

**Code:** the private GitHub repo [BayWatch](https://github.com/mohamedaminehamdi/BayWatch).

## The challenge in short

Ecurious provides reservation hardware that physically keeps a bay free, plus a camera that reads license plates, behind the Ecurious server. GoingElectric provides public charger data.
- **Mandatory:** a live cycle **reserve → arrive (plate check-in) → charge → release** on the real hardware. This is a prerequisite for the top ranks.
- **Mission areas:** at least two from No-Shows, Blocked Bays, Plate Recognition, Interoperability, New Use Cases, Utilisation and Business Case.
- **Judging:** Technical Implementation 30% · Concept & Innovation 20% · Business Case & CPO Value 20% · Interoperability & Scalability 15% · Documentation & Pitch 15%. GDPR handling is expected.

Full brief: [CHALLENGE.md](CHALLENGE.md).

| Deliverable | Where |
|---|---|
| 1. App prototype showing GoingElectric charge points | [web/](web/): Explore map and list with live GoingElectric data |
| 2. Full reservation cycle on the hardware | Runs end to end on the mock ([data flows §1](docs/data-flows.md#1-reserve--arrive--charge--release)). The real client is built and verified read-only. The run on the bay is the supervised [phase-2 test](docs/hardware-integration.md#phase-2-the-live-test-at-the-bay). |
| 3. Documentation: architecture, API calls, data flows, decisions, tools, what didn't work | [docs/](#docs) |
| 4. Answers to at least two mission areas | Six areas: [docs/mission-areas.md](docs/mission-areas.md) |
| 5. Limitations and scaling | [docs/limitations-and-scaling.md](docs/limitations-and-scaling.md) |

## User flows

**Driver** (web app, installable as a PWA):
1. Land on the home page, then sign up or sign in with Google or email (Clerk).
2. Add your car: plate, nickname, and consent to plate recognition.
3. **Explore:** real GoingElectric chargers on a map and a list, with search, "Locate me", "Fast ≥ 50 kW" and "Reservable only". Only the Ecurious bay is reservable; others show details and Navigate.
4. **Reserve:** pick your car and how long you'll charge: 30 min to 2 h on a fast bay, 1 to 4 h on a slow one, 1 h by default. See the price (by charger type and demand, never above €4) and the rules in plain words. Accept them, then confirm the demo payment.
5. **Booking:**
   - a live countdown to arrive, and Navigate;
   - "+5 min" when running late;
   - "I'm at the bay", once the camera has seen your car but couldn't read its plate;
   - "Different car today";
   - reminders 1 h and 15 min before your session ends.
   If another car is in your bay, your hold pauses and the nearest free chargers appear.
6. The camera reads your plate (misreads tolerated), the guard lowers, and you charge. Finish, or drive out, to get a receipt. Your history is under **Bookings**.

**Operator** (email listed in `OPERATOR_EMAILS`):
1. **Operator** tab: live bay status, and **blocked-bay alerts** with the plate. Alerts also arrive by email, without the plate. Use "Bay is clear" to resolve one.
2. 7-day KPIs: reservations, completion and no-show rates, time to arrive, blocked minutes, camera vs fallback check-ins, and revenue share. Plus a chart and the event log.
3. **Hardware panel:**
   - the guard (up, down or unknown) and, live, the bay's health;
   - a warning if the camera would lower the arm for any car, or if the arm is up without a booking;
   - "Lower the arm" for recovery.

**Partner app:** reserve for your driver by plate through OCPI-style `RESERVE_NOW`, then poll the status. The bay camera checks that car in like any other. Or link to the public bay page `/bay/{id}`. See [API](#api).

## API

- Every route, with its auth, request, response and errors: [docs/api-calls.md](docs/api-calls.md).
- Other charging apps use the partner API: the guide is [docs/api.md](docs/api.md), and the OpenAPI 3.1 spec is served at [`/openapi.json`](web/public/openapi.json).

| Partner endpoint (`Authorization: Token`) | What it does |
|---|---|
| `POST /ocpi/2.2.1/commands/RESERVE_NOW` | Reserve the bay for your driver, by plate, at the price your driver accepted |
| `POST /ocpi/2.2.1/commands/CANCEL_RESERVATION` | Cancel one of your reservations before the driver arrives |
| `GET /api/partner/v1/reservations/{reservation_id}` | Poll its status, arrival deadline and fees. We don't send callbacks. |

## Quickstart

You need Node.js 20.9 or later, and npm. Flutter is optional.

```bash
cd web
npm install
cp .env.example .env    # fill in the keys below
npx -y clerk@latest init  # only if web/.env.local has no Clerk keys yet: creates a temporary, claimable app
npm run dev             # http://localhost:3000
npm test                # booking rules, reservation engine, plates, operator stats, alert email, partner API
```

| Variable (`web/.env`) | Needed for | Notes |
|---|---|---|
| `GE_API_KEY` | Charge points on the map | [Request a key](https://www.goingelectric.de/stromtankstellen/api/new/) (needs a GoingElectric account) |
| `BAY_ID` | Partner API and bay page | The bay's OCPI `location_id` (default `ECU-TEST-1`). Its public page is `/bay/<BAY_ID>`. |
| `BAY_NAME`, `BAY_ADDRESS`, `BAY_LAT`, `BAY_LNG`, `BAY_POWER_KW` | The Ecurious bay | The coordinates are a Berlin placeholder: set the venue's, so "I'm at the bay" works (150 m) |
| `BAY_TYPE` | Price and slot limits | `fast` or `slow`. By default from power (≥ 50 kW is fast) |
| `HOLD_MINUTES` | Demos | Overrides the 15-min arrival grace, for example `1` to show a no-show. Fractions are allowed (`0.5` = 30 s). |
| `SIMULATOR` | The demo panel | `1` shows the "Demo" button (fake camera events, site demand, "Simulate a week"). **Never with `ECURIOUS_LIVE=1`:** a faked plate would move the real arm, so the server refuses to start with both. |
| `WEBHOOK_SECRET` | Real camera events | Required by `POST /api/plate-events`. If it's unset, all events are rejected. |
| `OPERATOR_EMAILS` | Operator dashboard and alert emails | Comma-separated sign-in emails |
| `RESEND_API_KEY`, `ALERT_FROM` | Alert emails | Optional. Without a domain, Resend delivers only to its own account's address. |
| `ECURIOUS_API_KEY` | Real hardware | The team's Ecurious server key. **On its own it doesn't go live:** that also needs `ECURIOUS_LIVE=1`. |
| `ECURIOUS_LIVE`, `ECURIOUS_MOCK` | Real hardware | `ECURIOUS_LIVE=1` moves the real arm. `ECURIOUS_MOCK=1` forces the mock, as the kill switch. The default is the mock. |
| `ECURIOUS_LOCK_ID`, `ECURIOUS_WHITELIST`, `ECURIOUS_VACANT_MS` | Real hardware | Set the bay (`lock-0001` to `lock-0003`: match the serial on the device). Put the booked plate on the camera's list (off until phase 2). Set the "car left" debounce (10 000 ms). See [hardware-integration.md](docs/hardware-integration.md#configuration). |
| `OCPI_PARTNER_TOKENS` | Partner API | `name:token,…` with lowercase names and tokens of 32+ characters (`openssl rand -hex 32`). Empty = the partner API is closed. |
| Clerk keys | Sign-in | Written to `web/.env.local` by `clerk init`. Claim the app with `npx clerk auth login`. Google sign-in is enabled. |

**Mobile (legacy):** `cd mobile && flutter run -d chrome --dart-define=API_URL=http://localhost:3000`. It shows the map and bay status, and can't reserve until it gets Clerk sign-in.

## Docs

| Doc | What's in it | Last updated |
|---|---|---|
| [architecture.md](docs/architecture.md) | Components, module map, state, security | 2026-10-24 |
| [api-calls.md](docs/api-calls.md) | Every route (auth, request, response, errors) and every external call | 2026-10-24 |
| [api.md](docs/api.md) | Integration guide for other charging apps (OCPI-style), by the interop agent | 2026-10-24 |
| [hardware-integration.md](docs/hardware-integration.md) | The Ecurious bay hardware: the API, live events, how the app maps onto it, safety, and the phase-2 test plan (hardware agent) | 2026-10-24 |
| [data-flows.md](docs/data-flows.md) | Sequence diagrams for every flow, plus where personal data goes and when it's erased | 2026-10-24 |
| [decisions.md](docs/decisions.md) | Design decisions (D1–D38) | 2026-10-24 |
| [tools.md](docs/tools.md) | Frameworks, services, test tooling, AI usage | 2026-10-24 |
| [what-did-not-work.md](docs/what-did-not-work.md) | An honest log of what failed and what we did | 2026-10-24 |
| [mission-areas.md](docs/mission-areas.md) | Our answers to six mission areas, with the business model | 2026-10-24 |
| [reservation-model.md](docs/reservation-model.md) | Reservation and pricing rules with 18 sources (pricing agent) | 2026-10-24 |
| [limitations-and-scaling.md](docs/limitations-and-scaling.md) | Limitations, scaling, open items for the Ecurious mentors | 2026-10-24 |
| [web/PRODUCT.md](web/PRODUCT.md), [web/DESIGN.md](web/DESIGN.md) | Product brief, and the Ecurious brand system (applied) | 2026-10-24 |

## Glossary

| Term | Meaning |
|---|---|
| **CPO** | Charge Point Operator: runs the chargers and pays for Bay Guard alerts |
| **eMSP** | e-Mobility Service Provider: the app or card a driver uses. A partner for our API. |
| **OCPI** | Open Charge Point Interface: the roaming protocol between CPOs and eMSPs. Its Commands module has `RESERVE_NOW` / `CANCEL_RESERVATION`. |
| **OCPP** | Open Charge Point Protocol: charger ↔ backend, with `ReserveNow` / `CancelReservation` |
| **LPR** | License plate recognition: the bay camera |
| **Bay Guard** | Our CPO plan: blocked-bay alerts, KPIs and the dashboard, at €19 per bay per month |

Fair play: we only use the provided hardware and server access, respect GoingElectric's terms (server-side key, modest request rate, attribution), and treat plates as personal data ([data-flows.md](docs/data-flows.md#personal-data)).
