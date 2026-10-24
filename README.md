# Baywatch

**Project board:** [BayWatch on Notion](https://app.notion.com/p/BayWatch-4032e6d9e3bb8033b730de17ef7f7b33?source=copy_link)

**Your charging spot, kept free.** Book any public charger for a time slot. On Baywatch bays, an Ecurious lock holds the bay, and its camera lets your car in by its license plate. Built for the Ecurious challenge at the Watt the Hack hackathon.

**Status (2026-10-24):**
- **Built:**
  - **Booking v2:** every GoingElectric charger is bookable on a 15-minute grid, up to 60 days ahead.
  - **Three Baywatch bays:** `bw-1` → `lock-0002` and `bw-2` → `lock-0003` are real Ecurious locks, and `bw-3` has no hardware yet. The dev server runs with live hardware.
  - **Booking rules:** class and demand pricing (€5 for a standard reservation, cap €10), a 100% no-show fee, cancellation tiers, overstay after 5 free minutes, blocked-bay re-routing with a €5 credit, and walk-up unlock.
  - The operator dashboard, the partner API (OCPI-style), and voice booking (Vapi).
  - **The Flutter app** ([mobile/](mobile/)): every web screen ported to Flutter, on the same API and Clerk accounts. Tested in Chrome; Android and iOS are configured but not yet built ([mobile/README.md](mobile/README.md)).
- **Not wired yet:** Stripe card payments are built and tested (test mode), but booking v2 uses the demo payment for now ([payments.md](docs/payments.md)).

**Code:** the private GitHub repo [BayWatch](https://github.com/mohamedaminehamdi/BayWatch). Working branch: `feat/booking-v2-voice-pricing`.

## The challenge in short

Ecurious provides reservation hardware that physically keeps a bay free, plus a camera that reads license plates, behind the Ecurious server. GoingElectric provides public charger data.
- **Mandatory:** a live cycle **reserve → arrive (plate check-in) → charge → release** on the real hardware. This is a prerequisite for the top ranks.
- **Mission areas:** at least two from No-Shows, Blocked Bays, Plate Recognition, Interoperability, New Use Cases, Utilisation and Business Case.
- **Judging:** Technical Implementation 30% · Concept & Innovation 20% · Business Case & CPO Value 20% · Interoperability & Scalability 15% · Documentation & Pitch 15%. GDPR handling is expected.

Full brief: [CHALLENGE.md](CHALLENGE.md).

| Deliverable | Where |
|---|---|
| 1. App prototype showing GoingElectric charge points | [web/](web/): Explore map and list with live GoingElectric data, every charger bookable |
| 2. Full reservation cycle on the hardware | `bw-1` and `bw-2` drive the real Ecurious locks: [data flows §1](docs/data-flows.md#1-book--arrive--charge--leave-a-bay-with-a-real-lock) and [hardware-integration.md](docs/hardware-integration.md) |
| 3. Documentation: architecture, API calls, data flows, decisions, tools, what didn't work | [docs/](#docs) |
| 4. Answers to at least two mission areas | Six areas: [docs/mission-areas.md](docs/mission-areas.md) |
| 5. Limitations and scaling | [docs/limitations-and-scaling.md](docs/limitations-and-scaling.md) |

## User flows

**Driver** (web app, installable as a PWA):
1. Land on the home page. Sign up or sign in with Google or email (Clerk). The first reservation is free.
2. Add your car: plate, nickname, and consent to plate recognition.
3. **Explore:** the three Baywatch bays (big violet dots) and every GoingElectric charger, with search, "Locate me" and a fast filter. A virtual LED shows whether a bay can be unlocked right now.
4. **Book now:** pick a start on the 15-minute grid (today or up to 60 days ahead) and a length up to the bay's class maximum (slow 4 h, fast 2 h, ultra 1 h). See the price (€5 for a standard fast reservation, more at busy hours, never above €10), the credit used, and the cancellation schedule. Accept the fees and pay (demo payment). At most 3 upcoming bookings.
5. **Your booking:**
   - reminders the day before, 30 min before (the booking goes live) and 5 min before;
   - Navigate, and arrive within 15 min of the start.
   - On a Baywatch bay, the arm rises 10 min before the start, and the camera lowers it for your plate (misreads tolerated). "I'm at the bay" works when the camera saw your car but couldn't read the plate.
6. **Blocked bay:** if another car is in your bay, you're re-routed to the nearest free bays ("Book instead"), you get a **€5 credit**, and you can cancel for free.
7. **Charge, then leave:** 5 free minutes after your slot, then €0.30/min. You get a receipt, and your history is under Bookings.
8. **Walk-up:** at a free bay, "Unlock now" lets you in at once, free, until the next booking. On a real lock, the camera must read one of your own plates.
9. **Voice:** tap the mic and say "Book bay 1 now for an hour". The assistant reads the quote back and books when you say yes ([voice-booking.md](docs/voice-booking.md)).

**Operator** (email listed in `OPERATOR_EMAILS`):
- **Per real bay:** status, blocked-bay alerts (with email), and the hardware panel (guard, sensor, health, "Lower the arm").
- **7-day KPIs:** including credits issued, walk-ups, and the overstay split.

**Partner app:** reserve a bay by id through OCPI-style `RESERVE_NOW`, with an optional `ecurious_start` and `ecurious_blocks` ([api.md](docs/api.md)).

## API

- Every route: [docs/api-calls.md](docs/api-calls.md).
- Other charging apps: the partner guide [docs/api.md](docs/api.md), and the OpenAPI 3.1 spec served at [`/openapi.json`](web/public/openapi.json).

| Main endpoints | What they do |
|---|---|
| `GET /api/bays`, `GET /api/bays/{id}/availability`, `GET /api/bays/{id}/quote` | Map bays, a day's 15-min blocks, a price |
| `POST /api/reservations`, `POST /api/reservations/{id}/{cancel, checkin, charge, finish}` | Book and manage a booking |
| `POST /api/bays/{id}/unlock` | Walk-up |
| `POST /ocpi/2.2.1/commands/RESERVE_NOW`, `CANCEL_RESERVATION`, `GET /api/partner/v1/reservations/{id}` | Partner apps (`Authorization: Token`) |

## Quickstart

You need Node.js 20.9 or later, and npm.

```bash
cd web
npm install
cp .env.example .env      # fill in the keys below
npx -y clerk@latest init  # only if web/.env.local has no Clerk keys yet: creates a temporary, claimable app
npm run dev               # http://localhost:3000
npm test                  # booking rules and schedule, hardware client, partner API, payments, voice, …
```

| Variable (`web/.env`) | Needed for | Notes |
|---|---|---|
| `GE_API_KEY` | Chargers on the map | [Request a key](https://www.goingelectric.de/stromtankstellen/api/new/) (needs an account) |
| `ECURIOUS_BAYS` | The Baywatch bays | `bw-1:lock-0002,bw-2:lock-0003,bw-3:`. Locks the team doesn't have are dropped at start-up, and `lock-0001` is never called. |
| `BAY_ADDRESS`, `BAY_LAT`, `BAY_LNG`, `BAY_POWER_KW` | Where the Baywatch bays are, and their power | Placeholder Berlin coordinates: set the venue's (the 150 m check-in and walk-up radius) |
| `HOLIDAYS` | Demand pricing | Dates priced as busy (`YYYY-MM-DD,…`) |
| `ECURIOUS_API_KEY`, `ECURIOUS_LIVE` | Real locks | Both are needed: `ECURIOUS_LIVE=1` makes bookings on `bw-1` and `bw-2` move the real arms. `ECURIOUS_MOCK=1` is the kill switch. |
| `ECURIOUS_WHITELIST`, `ECURIOUS_LOCK_ID`, `ECURIOUS_VACANT_MS` | Real locks | The camera whitelist is **on** by default (`0` turns it off). `ECURIOUS_LOCK_ID` is the CLI's lock (no fallback). The "car left" debounce defaults to 10 000 ms. |
| `SIMULATOR` | The demo panel | `1` = fake plates, a car in a simulated bay, site demand, "Simulate a week". Allowed with live hardware: demo events are refused (403) on bays with a real lock. |
| `WEBHOOK_SECRET` | Other camera sources | Required by `POST /api/plate-events`. Empty = all rejected. |
| `OPERATOR_EMAILS` | Operator dashboard and alert emails | Comma-separated sign-in emails |
| `RESEND_API_KEY`, `ALERT_FROM` | Alert emails | Optional |
| `OCPI_PARTNER_TOKENS` | Partner API | `name:token,…` (lowercase names, 32+ characters). Empty = closed. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Card payments (test mode) | Not wired into booking v2 yet. Paused for the demo, so the demo payment is used ([payments.md](docs/payments.md)). |
| `VOICE_DEMO`, `VAPI_BEARER_SECRET`, `VOICE_SESSION_SECRET`, `VOICE_DEMO_USER_ID` | Voice booking | `VOICE_DEMO=1` switches it on (demo payment). The bearer secret authenticates Vapi's webhook, and the session secret signs the mic's tokens. |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | The in-app mic | The mic shows only when both are set |
| Clerk keys | Sign-in | Written to `web/.env.local` by `clerk init`. Claim the app with `npx clerk auth login`. |

**The Flutter app** needs the web app running (it serves the API and the app's config):

```bash
cd mobile
flutter pub get
flutter run -d chrome   # phones: add --dart-define=API_URL=http://<your computer's LAN address>:3000
```

## Docs

| Doc | What's in it | Last updated |
|---|---|---|
| [architecture.md](docs/architecture.md) | Components, module map, state, security | 2026-10-24 |
| [api-calls.md](docs/api-calls.md) | Every route and every external call | 2026-10-24 |
| [api.md](docs/api.md) | Integration guide for other charging apps (OCPI-style) | 2026-10-24 |
| [data-flows.md](docs/data-flows.md) | The v2 cycle with real hardware, blocked bays, walk-up, voice, fees, personal data | 2026-10-24 |
| [reservation-model.md](docs/reservation-model.md) | Booking v2 rules and prices, with 18 sources | 2026-10-24 |
| [hardware-integration.md](docs/hardware-integration.md) | The Ecurious locks: API, events, safety, test plan | 2026-10-24 |
| [payments.md](docs/payments.md) | Stripe test mode: holds and capture | 2026-10-24 |
| [voice-booking.md](docs/voice-booking.md) | Voice booking with Vapi | 2026-10-24 |
| [unit-economics.md](docs/unit-economics.md) | Revenue split and hardware payback | 2026-10-24 |
| [decisions.md](docs/decisions.md) | Design decisions | 2026-10-24 |
| [tools.md](docs/tools.md) | Frameworks, services, test tooling, AI usage | 2026-10-24 |
| [what-did-not-work.md](docs/what-did-not-work.md) | What failed and what we did | 2026-10-24 |
| [mission-areas.md](docs/mission-areas.md) | Our answers to six mission areas | 2026-10-24 |
| [limitations-and-scaling.md](docs/limitations-and-scaling.md) | Limitations, scaling, open items | 2026-10-24 |
| [web/PRODUCT.md](web/PRODUCT.md), [web/DESIGN.md](web/DESIGN.md) | Product brief, and the brand system | 2026-10-24 |
| [mobile/README.md](mobile/README.md) | The Flutter app: screen map to the web, running it, sign-in, platforms | 2026-10-24 |

## Glossary

| Term | Meaning |
|---|---|
| **CPO** | Charge Point Operator: runs the chargers and pays for Bay Guard alerts |
| **eMSP** | e-Mobility Service Provider: the app or card a driver uses. A partner for our API. |
| **OCPI** | Open Charge Point Interface: the roaming protocol. Its Commands module has `RESERVE_NOW` / `CANCEL_RESERVATION`. |
| **OCPP** | Open Charge Point Protocol: charger ↔ backend, with `ReserveNow` / `CancelReservation` |
| **LPR** | License plate recognition: the bay camera |
| **Walk-up** | Unlocking a free bay on the spot, without a booking |

Fair play: we only use the provided hardware and server access (`lock-0001` is no longer the team's and is never called), respect GoingElectric's terms, and treat plates as personal data ([data-flows.md](docs/data-flows.md#personal-data)).
