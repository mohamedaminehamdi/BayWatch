# Design decisions

_Last updated: 2026-10-24. Newest decisions are at the bottom. Every decision below was made on 2026-10-24, during the hackathon._

Each entry gives the decision, why we made it, and what follows from it.

### D1. Start with a zero-dependency prototype
- **Decision:** plain Node (`node:http`) plus one HTML page, with the Ecurious server mocked behind three functions.
- **Why:** prove the reserve → plate check-in → charge → release cycle within the first hour.
- **Consequence:** replaced by D3. The mock adapter shape (`reserve`, `release`, `status`) survived.

### D2. Mobile at first as an installable web app (PWA)
- **Decision:** a manifest and icons, with no service worker.
- **Why:** the Mac had no native toolchain. A PWA installs from the browser.
- **Consequence:** the web app is still installable. Flutter was added next (D4).

### D3. Rebuild on Next.js, one backend for every client
- **Decision:** Next.js 16 App Router route handlers serve the web pages **and** the API used by Flutter and partners.
- **Why:** the team asked for Next.js and Flutter. A single backend means a single copy of the reservation logic.
- **Consequence:** [reservation.ts](../web/lib/reservation.ts) is the one place the rules live.

### D4. Flutter in Chrome only
- **Decision:** the Flutter app runs as Flutter web. The iOS and Android projects are generated but not built.
- **Why:** Xcode wasn't the active developer tool and there was no Android SDK. The team chose Chrome over installing either.
- **Consequence:** Flutter lags the web app. It can't reserve since D7 ([limitations](limitations-and-scaling.md)).

### D5. Camera events through a fail-closed webhook; the simulator on its own route
- **Decision:** `POST /api/plate-events` requires `WEBHOOK_SECRET` (constant-time compare) and rejects everything when it's unset. Demo plate events go to `/api/sim/plate-events`, which only exists with `SIMULATOR=1`.
- **Why:** an automated security review flagged a fail-open check. A matching plate physically opens the bay.
- **Consequence:** the demo needs `SIMULATOR=1`, and it must never be set next to real hardware.

### D6. Reservation ownership, first as a token
- **Decision:** a secret token per reservation, required for cancel, charge and finish.
- **Why:** a second security review found that anyone could cancel anyone's booking, which releases the bay.
- **Consequence:** superseded by D7.

### D7. Accounts with Clerk; ownership by Clerk user id
- **Decision:** `npx clerk init` in accountless mode, with Google and email sign-in. Reservations carry `ownerId`, checked on every action and never serialised.
- **Why:** the team wanted a real login flow (landing → sign in → app). Accountless mode needed no account to start.
- **Consequence:**
  - The Clerk app is temporary until claimed (`npx clerk auth login`).
  - Flutter needs Clerk before it can reserve again.
  - Pages are protected per resource (`auth.protect()` in the `(app)` layout, `auth()` in routes), because `createRouteMatcher` is deprecated.

### D8. Drivers' cars in Clerk private metadata, no database
- **Decision:** up to 5 cars per driver in `privateMetadata` (server-only), each with a consent timestamp.
- **Why:** the cars persist without our own database, and they're deleted with the account.
- **Consequence:** the plate data sits with a US processor, which needs its data processing agreement and standard contractual clauses. Writes are read-modify-write without a lock.

### D9. In-memory state, one process
- **Decision:** a `globalThis` singleton for the engine, with history capped at 300.
- **Why:** less than a day of build time, and one physical bay.
- **Consequence:** it must run as one `next start`, not serverless. A restart loses bookings, but not cars.

### D10. Turn off Next 16 Cache Components
- **Decision:** removed `cacheComponents` from the scaffold.
- **Why:** it would have pre-rendered `GET /api/state` at build time, freezing live bay status.
- **Consequence:** route handlers run on every request.

### D11. MapLibre + OpenFreeMap instead of Leaflet + OSM tiles
- **Decision:** vector maps (positron style) via `react-map-gl/maplibre`, with GoingElectric points clustered.
- **Why:** the redesign judged the raster map poor. OpenFreeMap needs no key and allows commercial use. Clustering handles 100–500 points.
- **Consequence:** WebGL map. Attribution is shown automatically.

### D12. GoingElectric only through our server
- **Decision:** `/api/chargers` proxies map-area searches. The landing page's nearby count is cached for 6 h.
- **Why:** the key stays secret, and we keep the request rate modest under GoingElectric's terms.
- **Consequence:** no charge points without `GE_API_KEY` (the UI shows a note).

### D13. Search on submit only (Nominatim)
- **Decision:** place search when the user submits, with no autocomplete.
- **Why:** Nominatim's usage policy forbids search-as-you-type.

### D14. Visual identity, first pass: green from the challenge PDF
- **Decision:** deep green `#1F6E5A` (from the brief's table header), a safety-yellow accent (from the yellow device in the challenge photo), Barlow type, and Tailwind v4 with our own small set of UI primitives and native `<dialog>`.
- **Why:** the team chose "Ecurious green". The design skill banned the first font pick (Plus Jakarta Sans).
- **Consequence:** superseded by D15. Components use theme tokens only, so a retheme is mostly one file.

### D15. Visual identity, second pass: the real Ecurious brand (in progress)
- **Decision:** retheme to the system on ecurious.com, documented in [web/DESIGN.md](../web/DESIGN.md):
  - paper `#F5F4F1` and ink `#0F1419`;
  - voltage lime `#C8E847`, only as a fill with ink on it;
  - ultraviolet `#5A1DF0` as the accent that reads on light backgrounds;
  - Bebas Neue (headlines), Space Grotesk (body) and JetBrains Mono (labels and buttons) through `next/font`.
- **Why:** the user asked for the UI in the Ecurious brand.
- **How the values were taken:** from the site's own CSS via playwright-cli, because Firecrawl wasn't logged in.
- **Constraints:**
  - Every colour pairing was checked for WCAG AA with a script.
  - The Ecurious wordmark isn't used until Ecurious staff give permission; until then it's a text-only "Powered by Ecurious".
- **Status:** in progress. Phase 2a is the shared UI. Phase 2b, Explore and booking, follows the fee wiring.
- **Finding:** ecurious.com presents Ecurious as a smart-charging marketplace ("one card, every charger, best price", launching Sept 2026, Munich), and the reservation hardware isn't on the site. So we position reservations as a feature of the Ecurious app and card.

### D16. Mock payments; the charges list is the receipt
- **Decision:** "Demo payment, no card charged". Every fee, refund and release is a line in `charges`.
- **Why:** no time for a real payment provider. One structure serves the receipt, refunds and operator revenue.
- **Consequence:** the research recommends billing small fees with the next charging session instead of as separate card payments ([reservation-model.md](reservation-model.md)).

### D17. Blocked bay: pause, alert, don't expose
- **Decision:**
  - When a car that isn't the booked one is in a reserved bay, the hold pauses and an operator alert opens.
  - The driver may cancel for free and sees the nearest public chargers.
  - The blocker's plate is visible to operators only, erased on resolve, and never emailed.
- **Why:** it's not the driver's fault. The operator needs the plate to act, and the plate is personal data.

### D18. CPO alerts on the dashboard and by email (Resend)
- **Decision:** a plain `fetch` to Resend's REST API, with no SDK. It never throws, and the delivery status shows on the dashboard.
- **Why:** the team chose email. The operator pays for alerts ("Bay Guard").
- **Consequence:** until a domain is verified, Resend only delivers to the account's own address.

### D19. Operators by email allowlist
- **Decision:** `OPERATOR_EMAILS` grants the dashboard and alert emails.
- **Why:** simplest for one operator. Clerk Organizations would be the multi-tenant upgrade.

### D20. Misread-tolerant plate matching, only against the active booking
- **Decision:** exact, then confusable characters, then one edit on plates of 6 or more characters. Each match is recorded as `exact` or `fuzzy`.
- **Why:** real cameras misread dirty or angled plates. With one booking per bay, a fuzzy match can't pick the wrong driver.

### D21. Fallback check-in by location
- **Decision:** "I'm at the bay" within 150 m. The coordinates are never stored.
- **Why:** it handles unreadable plates now. It's spoofable, so on site we'd prefer a code on the hardware display or a QR sticker.

### D22. Reservation and pricing model, the team's decisions
Details and sources: [reservation-model.md](reservation-model.md).
- **Fees:**
  - Base €2.50 for fast (DC, ≤2 h) or €1.50 for slow (AC, ≤4 h).
  - Demand multiplier from 0.8× to 2×, capped at €4 (the mentor called €5 too much).
- **No-show:** 50% of the fee.
- **Cancellation:**
  - Tiers are **shares of the no-show fee**, so cancelling always costs less than not turning up.
  - **Free 24 h or more ahead.**
  - Free within 2 min of booking, or while the bay is blocked.
- **Repeat no-shows:** **3 no-shows in the last 10 bookings (90 days)** means prepaying, with a warning at 2.
- **Arrival and overstay:** 15 min arrival grace. 15 min overstay grace, then €0.25/min (fast) or €0.10/min (slow), capped at €12.
- **Operators:** the CPO plan "Bay Guard" is €19 per bay per month, and the CPO keeps 70% of reservation fees.
- **Removed:** the earlier "+€5 on a second no-show" was dropped.

### D23. "Reserve now" only; advance booking is planned
- **Decision:** the session starts when the driver books. Fixed-time advance slots are pitch-only.
- **Why:** advance booking needs a slot schedule with overlap checks, pre-start reminders and a decision on device lock timing. That's too much for under a day.
- **Consequence:** after the free 2 minutes, every cancellation falls in the 60% tier, so the cheaper tiers are unreachable today.

### D24. Partner API: OCPI-style commands, no callbacks (in progress)
- **Decision:** `RESERVE_NOW` / `CANCEL_RESERVATION` with partner tokens, plus an `ecurious_license_plate` extension so the camera recognises another app's driver. Partners poll a status endpoint.
- **Why:** OCPI is how operators and service providers already talk. Calling partner-supplied `response_url`s would be an SSRF risk.
- **Consequence:** see [api.md](api.md). The user asked that the API always be documented for other apps.

### D25. Built by several AI agents with file ownership
- **Decision:** separate background agents, each owning its own files to avoid edit conflicts:
  - builder (app);
  - pricing research (rules + doc);
  - brand (DESIGN.md, then the retheme);
  - interop (partner API + api.md);
  - docs (this folder + README).
- **Why:** less than a day, with parallel work.
- **Consequence:** some docs describe features as "being wired" while agents finish them.
