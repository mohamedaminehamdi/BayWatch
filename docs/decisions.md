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

### D15. Visual identity, second pass: the real Ecurious brand
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
- **Status:** built.
  - First the shared UI, then Explore and booking.
  - Then the leftovers: an offline map pin, the bay page buttons "Reserve this bay" and "Open in the app", the end time in the header pill, and the unused `--color-dc` token removed.
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
- **Consequence:** superseded by D31, because location alone was enough to open the bay.

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
- **Repeat no-shows:** **3 no-shows in the last 10 bookings (90 days)** means prepaying, with a warning at 2. Every prototype booking is already paid up front, so "prepaying" means the 50% no-show refund is withheld.
- **The price shown is the price paid:** the fee is fixed at booking. If demand moves it before the driver pays, the booking is refused with the new price (409), and the driver confirms again.
- **Arrival and overstay:** 15 min arrival grace. 15 min overstay grace, then €0.25/min (fast) or €0.10/min (slow), capped at €12.
- **Operators:** the CPO plan "Bay Guard" is €19 per bay per month, and the CPO keeps 70% of reservation fees.
- **Removed:**
  - the earlier "+€5 on a second no-show" and its 30-day window;
  - the old arrival reminder before the hold ended.

### D23. "Reserve now" only; advance booking is planned
- **Decision:** the session starts when the driver books. Fixed-time advance slots are pitch-only.
- **Why:** advance booking needs a slot schedule with overlap checks, pre-start reminders and a decision on device lock timing. That's too much for under a day.
- **Consequence:** after the free 2 minutes, every cancellation falls in the 60% tier, so the cheaper tiers are unreachable today.
- **Session lengths:**
  - Fast bays offer 30 min, 1 h, 1 h 30 and 2 h. Slow bays offer 1 to 4 h. The default is 1 h.
  - `SIMULATOR=1` adds a 16-minute demo length, so the 15-minute reminder shows a minute after check-in.

### D24. Partner API: OCPI-style commands (built)
- **Decision:**
  - OCPI 2.2.1-style `RESERVE_NOW` / `CANCEL_RESERVATION` for partner apps (eMSPs), with hand-issued partner tokens.
  - Four required extensions: `ecurious_license_plate`, `ecurious_plate_consent`, `ecurious_session_minutes` and `ecurious_fee_cents`.
  - A public bay page `/bay/{id}` with link previews, a deep link `/explore?bay=…&reserve=1`, and an OpenAPI 3.1 spec at `/openapi.json`.
- **Why:**
  - OCPI is how operators and service providers already talk.
  - The plate lets the camera recognise another app's driver, with no Ecurious account.
  - The fee field makes the partner confirm the price its driver saw, as the app does. A moved price is REJECTED with the new one.
- **Consequence:** the details are D26–D30 and [api.md](api.md). The user asked that the API always be documented for other apps.

### D25. Built by several AI agents with file ownership
- **Decision:** separate background agents, each owning its own files to avoid edit conflicts:
  - builder (app);
  - pricing research (rules + doc);
  - brand (DESIGN.md, then the retheme);
  - interop (partner API + api.md);
  - hardware (the Ecurious client, bridge, CLI + hardware-integration.md);
  - docs (this folder + README).
- **Why:** less than a day, with parallel work.
- **Consequence:** some docs describe features as "being wired" while agents finish them.

### D26. Partners poll; we never call partner URLs
- **Decision:** every CommandResponse is final (`timeout: 0`), with no `CommandResult` callback. Partners poll `GET /api/partner/v1/reservations/{id}`, and `response_url` is validated but never called.
- **Why:** calling URLs a partner supplies invites server-side request forgery (SSRF): our server could be made to reach internal networks. Our answer is synchronous anyway.
- **Consequence:** a deliberate deviation from OCPI 2.2.1. Callbacks could come later, but only to hosts a partner registers in the OCPI Credentials handshake ([api.md](api.md#roaming-outlook)).

### D27. Partner bookings are owned per driver token
- **Decision:** a partner booking's owner is `partner:<name>:<token uid>`.
- **Why:** the no-show fee and the prepay rule must follow the driver, not the whole partner app. One unreliable driver shouldn't put every driver of that app on prepay.
- **Consequence:** the reliability rule works for drivers without an Ecurious account. The uid is kept with the booking outcome and never returned.

### D28. A repeated `reservation_id` is an idempotent retry
- **Decision:** the same `reservation_id` again returns the same ACCEPTED answer and changes nothing. OCPI's "replace" isn't supported: to change a booking, cancel it and book again.
- **Why:** answers get lost on mobile networks, and a retry must never double-book.
- **Consequence:** reusing an id after its booking ended is REJECTED. The id links are kept in memory, up to 500.

### D29. 60 requests a minute per partner
- **Decision:** a fixed one-minute window per partner, counting commands and polls together. Past it, the answer is 429 with `Retry-After`.
- **Why:** polling invites tight loops, and one partner mustn't slow the bay down for everyone.
- **Consequence:** the window is in memory, for one process. It moves to an API gateway or Redis once there are more instances.

### D30. Partner tokens plain or Base64
- **Decision:** `Authorization: Token <token>` matches whether the token is sent as is or Base64-encoded. Both forms are compared as SHA-256 digests with `timingSafeEqual`, against every configured entry.
- **Why:** OCPI 2.2.1 Base64-encodes the token, but many OCPI 2.1/2.2 clients send it plain.
- **Consequence:** equal-length digests keep the check constant-time. No configured token means 401 for everyone: it fails closed.

### D31. The fallback check-in needs evidence from the bay
- **Decision:** "I'm at the bay" only works when the bay itself saw a car in the last 3 minutes, and the driver is within 150 m. The evidence is an unreadable plate read, or the presence sensor once it's wired. The button only appears then.
- **Why:** a security review of the pushed commit found that the client's reported location alone could lower the arm, and coordinates are easy to fake from anywhere.
- **Consequence:** location is now only an extra check. If the camera hasn't seen the car, the driver drives up to the guard or asks the operator. This supersedes D21.

### D32. Real hardware is opt-in; the mock is the default
- **Decision:**
  - Live mode needs `ECURIOUS_API_KEY` **and** `ECURIOUS_LIVE=1`, and `ECURIOUS_MOCK=1` always forces the mock.
  - The adapter only touches bays that our key lists, and refuses any other `ECURIOUS_LOCK_ID`.
- **Why:**
  - The key sits in `web/.env`, and the dev server reloads `lib/` on save. Without the gate, any dev session or automated UI test could move the real arm.
  - Touching only our own bays is the fair-play rule.
- **Consequence:** `SIMULATOR=1` must never run in live mode, since a faked plate would move the arm. The server refuses to load with both set (a config error).

### D33. A hold replaces the camera's plate list
- **Decision:** on reserve, the camera's list becomes `[]` by default, or the booked plate with `ECURIOUS_WHITELIST=1`. It's cleared at check-in, cancel or no-show. We never send `wildcard`.
- **Why:**
  - Every bay shipped with `["*"]`, so the camera lowered the arm for any car, which defeats a hold.
  - Our own misread-tolerant match is the default, because one of the two whitelist specs suggests the camera may drop plates without a Chinese province prefix.
- **Consequence:** with the list on, the camera lowers the arm itself for the booked car, which is the fastest path. The phase-2 test decides whether to turn it on.

### D34. `cancelAutoLift` instead of keep-state modes
- **Decision:** lock and unlock both send `{cancelAutoLift: true}`, so the arm stays where we put it. `keep-state` is only a manual recovery step.
- **Why:**
  - Without the flag, the device may raise the arm again after a timeout: under a car that's still manoeuvring, or on a bay the app shows as free.
  - `keep_open` and `keep_closed` are permanent modes. They need two writes per change, and can't be read back.
- **Consequence:** the end of a session needs no call, because the arm has been down since check-in. What auto-lift really does is checked in phase 2.

### D35. Live events over SSE through a bridge; the webhook stays
- **Decision:**
  - A bridge, started once per server by `instrumentation.ts`, turns the Ecurious event stream into `plateEvent()` calls, one at a time.
  - "Car left" is the engine's `vacated()`, after 10 s of vacant sensor (`ECURIOUS_VACANT_MS`). It needs no plate, so it also ends a session that was checked in by hand.
  - A plate read in an unbooked bay waits up to 2 min for a car to actually pull in.
  - `POST /api/plate-events` stays for any other camera source.
- **Why:**
  - The Ecurious server pushes its events on a stream.
  - The debounce stops a sensor flicker from ending a session.
  - The wait stops a passing car from marking the bay as taken.
- **Consequence:** the stream has no replay, so `status()` also reads over REST.

### D36. Hardware safety rules
- **Decision:**
  - The arm never rises onto a car or on an offline bay: `reserve()` reads the bay fresh and refuses, and the booking rolls back.
  - Commands are never retried, and a failed one blocks new commands for 30 s. Reads retry twice.
  - `status()` is cached for 5 s, serves a stale value while it re-reads, and never throws.
  - A failed reserve rolls the booking back with the hardware's reason. A failed cancel keeps the booking reserved, so the driver can retry.
  - Operators can lower the arm by hand from the dashboard, for recovery, and it's logged.
- **Why:**
  - A ground lock rising under a car is the worst possible failure.
  - After a timeout, the arm may already be moving, or be left up with no booking.
  - Every client polls every 2 s, and a poll must never wait on the hardware.
- **Consequence:** the no-show release retries about twice a minute at most.

### D37. An offline bay says so, and can't be booked
- **Decision:** when `hardware.online` is false, the map pin reads "Ecurious bay, offline right now", and Reserve is disabled everywhere: the bay panel, the reserve dialog and the bay page.
- **Why:** `reserve()` would refuse an offline bay anyway (D36). Telling drivers up front saves them a failed booking at the payment step.
- **Consequence:** the mock always reports the bay as online, so the state only shows up in live mode.

### D38. End times, not countdowns, in the header pill
- **Decision:** the header pill shows when the hold ends ("Held until 13:38"). Countdowns elsewhere are labelled as time left, next to the clock time.
- **Why:** a bare m:ss countdown ("12:30") read like a clock time.
