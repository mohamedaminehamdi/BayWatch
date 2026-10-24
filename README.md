# Ecurious Reserve

**Your charging spot, kept free.** A charging app for public EV charging that reserves a bay with Ecurious hardware and checks you in by license plate when you arrive. Built for the Ecurious challenge at the Watt the Hack hackathon.

**Status (2026-10-24):**
- **Built:** the driver app (landing → sign-in → find → reserve → arrive → charge → receipt) and the operator dashboard. The full cycle runs against a **mock** Ecurious server.
- **In progress:** the real hardware API (docs come on site), the new fee rules in the UI, the partner API for other apps, and the Ecurious brand retheme.

## The challenge in short

Ecurious provides reservation hardware that physically keeps a bay free, plus a camera that reads license plates, behind the Ecurious server. GoingElectric provides public charger data.
- **Mandatory:** a live cycle **reserve → arrive (plate check-in) → charge → release** on the real hardware. This is a prerequisite for the top ranks.
- **Mission areas:** at least two from No-Shows, Blocked Bays, Plate Recognition, Interoperability, New Use Cases, Utilisation and Business Case.
- **Judging:** Technical Implementation 30% · Concept & Innovation 20% · Business Case & CPO Value 20% · Interoperability & Scalability 15% · Documentation & Pitch 15%. GDPR handling is expected.

Full brief: [CHALLENGE.md](CHALLENGE.md).

| Deliverable | Where |
|---|---|
| 1. App prototype showing GoingElectric charge points | [web/](web/): Explore map and list with live GoingElectric data |
| 2. Full reservation cycle on the hardware | Built against the mock, see [data flows §1](docs/data-flows.md#1-reserve--arrive--charge--release). Real API pending, see [open items](docs/limitations-and-scaling.md#open-items-for-the-ecurious-mentors). |
| 3. Documentation: architecture, API calls, data flows, decisions, tools, what didn't work | [docs/](#docs) |
| 4. Answers to at least two mission areas | Six areas: [docs/mission-areas.md](docs/mission-areas.md) |
| 5. Limitations and scaling | [docs/limitations-and-scaling.md](docs/limitations-and-scaling.md) |

## User flows

**Driver** (web app, installable as a PWA):
1. Land on the home page, then sign up or sign in with Google or email (Clerk).
2. Add your car: plate, nickname, and consent to plate recognition.
3. **Explore:** real GoingElectric chargers on a map and a list, with search, "Locate me", "Fast ≥ 50 kW" and "Reservable only". Only the Ecurious bay is reservable; others show details and Navigate.
4. **Reserve:** pick your car, see the price (by charger type and demand, never above €4) and the rules in plain words, then confirm the demo payment.
5. **Booking:**
   - a live countdown to arrive, and Navigate;
   - "+5 min" when running late;
   - "I'm at the bay" if the camera can't read your plate;
   - "Different car today".
   If another car is in your bay, your hold pauses and the nearest free chargers appear.
6. The camera reads your plate (misreads tolerated), the guard lowers, and you charge. Finish, or drive out, to get a receipt. Your history is under **Bookings**.

**Operator** (email listed in `OPERATOR_EMAILS`):
1. **Operator** tab: live bay status, and **blocked-bay alerts** with the plate. Alerts also arrive by email, without the plate. Use "Bay is clear" to resolve one.
2. 7-day KPIs: reservations, completion and no-show rates, time to arrive, blocked minutes, camera vs fallback check-ins, and revenue share. Plus a chart and the event log.

**Partner app** (in progress): reserve through OCPI-style `RESERVE_NOW` / `CANCEL_RESERVATION` with a partner token, or link to `/bay/{id}`. See [docs/api.md](docs/api.md).

## Quickstart

You need Node.js 20.9 or later, and npm. Flutter is optional.

```bash
cd web
npm install
cp .env.example .env    # fill in the keys below
npx -y clerk@latest init  # only if web/.env.local has no Clerk keys yet: creates a temporary, claimable app
npm run dev             # http://localhost:3000
npm test                # booking rules, reservation engine, plates, operator stats, alert email
```

| Variable (`web/.env`) | Needed for | Notes |
|---|---|---|
| `GE_API_KEY` | Charge points on the map | [Request a key](https://www.goingelectric.de/stromtankstellen/api/new/) (needs a GoingElectric account) |
| `BAY_NAME`, `BAY_ADDRESS`, `BAY_LAT`, `BAY_LNG`, `BAY_POWER_KW` | The Ecurious bay | The coordinates are a Berlin placeholder: set the venue's, so "I'm at the bay" works (150 m) |
| `BAY_TYPE` | Price and slot limits | `fast` or `slow`. By default from power (≥ 50 kW is fast) |
| `HOLD_MINUTES` | Demos | Overrides the 15-min arrival grace, for example `1` to show a no-show |
| `SIMULATOR` | The demo panel | `1` shows the "Demo" button (fake camera events, site demand, "Simulate a week"). **Never next to real hardware.** |
| `WEBHOOK_SECRET` | Real camera events | Required by `POST /api/plate-events`. If it's unset, all events are rejected. |
| `OPERATOR_EMAILS` | Operator dashboard and alert emails | Comma-separated sign-in emails |
| `RESEND_API_KEY`, `ALERT_FROM` | Alert emails | Optional. Without a domain, Resend delivers only to its own account's address. |
| `ECURIOUS_API_KEY` | Real hardware | Stored. It gets used once the on-site API docs replace the mock. |
| `OCPI_PARTNER_TOKENS` | Partner API (in progress) | `name:token,…` |
| Clerk keys | Sign-in | Written to `web/.env.local` by `clerk init`. Claim the app with `npx clerk auth login`. Google sign-in is enabled. |

**Mobile (legacy):** `cd mobile && flutter run -d chrome --dart-define=API_URL=http://localhost:3000`. It shows the map and bay status, and can't reserve until it gets Clerk sign-in.

## Docs

| Doc | What's in it | Last updated |
|---|---|---|
| [architecture.md](docs/architecture.md) | Components, module map, state, security | 2026-10-24 |
| [api-calls.md](docs/api-calls.md) | Every route (auth, request, response, errors) and every external call | 2026-10-24 |
| [api.md](docs/api.md) | Integration guide for other charging apps (OCPI-style) | in progress |
| [data-flows.md](docs/data-flows.md) | Sequence diagrams for every flow, plus where personal data goes and when it's erased | 2026-10-24 |
| [decisions.md](docs/decisions.md) | Design decisions (D1–D25) | 2026-10-24 |
| [tools.md](docs/tools.md) | Frameworks, services, test tooling, AI usage | 2026-10-24 |
| [what-did-not-work.md](docs/what-did-not-work.md) | An honest log of what failed and what we did | 2026-10-24 |
| [mission-areas.md](docs/mission-areas.md) | Our answers to six mission areas, with the business model | 2026-10-24 |
| [reservation-model.md](docs/reservation-model.md) | Reservation and pricing rules with 18 sources (pricing agent) | 2026-10-24 |
| [limitations-and-scaling.md](docs/limitations-and-scaling.md) | Limitations, scaling, open items for the Ecurious mentors | 2026-10-24 |
| [web/PRODUCT.md](web/PRODUCT.md), [web/DESIGN.md](web/DESIGN.md) | Product brief, and the Ecurious brand system (being applied) | 2026-10-24 |

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
