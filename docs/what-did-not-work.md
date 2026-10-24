# What did not work

_Last updated: 2026-10-24, booking v2. An honest log of what failed, surprised us or had to be redone. Newest entries are at the bottom of each section._

## Hardware, data and environment

| What happened | What we did |
|---|---|
| **The Ecurious API docs weren't public.** Web searches found nothing, and the brief says they're handed out on site. | Built against a 3-function mock and a plate webhook first. With the docs and the team key on site, the real client filled in those 3 functions without changing their signatures ([hardware-integration.md](hardware-integration.md)). |
| **The venue location is unknown.** A search for the hackathon venue found nothing. | The bay coordinates are a Berlin placeholder (`BAY_LAT`/`BAY_LNG`). "I'm at the bay" only works within 150 m, so it needs the real coordinates on site. |
| **The challenge PDF disappeared from the project folder.** It was never committed, and it was gone before any cleanup ran. | The full text is in [CHALLENGE.md](../CHALLENGE.md). |
| **No native mobile toolchain.** Xcode was installed but not active, and there was no Android SDK or Java. | The Flutter port was built and tested in Chrome. The Android and iOS configs (permissions, `minSdk 24`, the Podfile) are set, but those builds haven't run on this machine. |
| **Flutter couldn't reserve, and a teammate got the old UI.** Reservations need a signed-in Clerk user since accounts were added, and `mobile/` was still the first prototype. | Ported every web screen to Flutter, signed in with `clerk_auth` and Bearer tokens (D49). |
| **The GoingElectric data is dense:** 123 locations within 2 km of the bay, and up to 500 per request. | MapLibre clustering, and a list capped at the nearest ~50. |
| **Nominatim forbids search-as-you-type.** | Search runs on submit only. |
| **A session checked in by hand wouldn't have ended when the car left.** The bridge's "car left" event carried the plate the camera had checked in, and a fallback check-in has none. | The car sensor now calls the engine's `vacated()`, which needs no plate. |
| **Resend delivers only to the account's own address** until a domain is verified. | Alerts always show on the dashboard. The email status reads sent, skipped or failed. |

## The bay hardware: the docs vs the real server

All of these were read live, read-only. Details: [hardware-integration.md](hardware-integration.md#what-the-docs-say-and-what-the-server-does).

| What happened | What we did |
|---|---|
| **Every bay shipped with the camera's plate list set to `["*"]`,** so the camera lowered the arm for any car. That defeats a hold. | A hold replaces the list with `[]`, or the booked plate, and clears it afterwards ([D33](decisions.md)). |
| **A status the docs don't mention:** `offline` (one bay was offline for half an hour). | `reserve()` refuses an offline bay, and the booking rolls back with a clear message. |
| **Event names carry a `lock:` prefix** (`lock:heartbeat`, and `lock:car_presence` rather than `vehicle_presence`). | The parser accepts the real names, the documented ones, and the raw device codes. |
| **`/whitelist` is documented twice, and the specs contradict each other.** One example keeps only plates with a Chinese province prefix, so a German plate might be dropped (unverified). | `ECURIOUS_WHITELIST` stays off, and our own misread-tolerant matching is the default. The adapter checks the echoed list and warns. Phase 2 settles it. |
| **What auto-lift means is unclear:** how long the timeout is, and whether it re-raises the arm after a car leaves. | We send `cancelAutoLift: true` on both lock and unlock, so the arm stays where we put it ([D34](decisions.md)). Phase 2 measures it. |
| **`battery3_7V` and `signalStrength4G` read 0 on every bay.** `battery12V` reads about 15 V, which suggests mains power. | They're shown as reported, and we've asked the mentors. |
| **`plate/latest` answers 404** for a bay that hasn't read a plate yet. | Not used: the event stream carries the reads. |

## Build and framework

| What happened | What we did |
|---|---|
| **Leaflet's default marker image broke** under the bundler. | Circle markers at first, then MapLibre replaced Leaflet. |
| **Next 16's scaffold enables Cache Components,** which would have pre-rendered `GET /api/state` at build time and frozen the live bay status. | Turned it off ([decision D10](decisions.md)). |
| **Clerk v7 deprecated `createRouteMatcher`,** the usual way to protect routes in middleware. | Each resource is protected where it lives: `auth.protect()` in the `(app)` layout, and `auth()` with a 401 in every route. |
| **React hydration mismatch:** the plate badge's EU stars used `Math.sin`/`Math.cos` while rendering, and Node and the browser differ in the last digits. | The coordinates are precomputed and rounded to 3 decimals. We then checked every SSR'd component for render-time `Date.now()`, random or locale formatting. |
| **The unclaimed Clerk app is called "My Application",** and Clerk's card clipped the side borders of its inputs. | Titles are overridden in code, and the inputs are restyled. |
| **A background build stopped a third of the way through** when plan mode was switched on, leaving the app unable to compile (old components still imported the removed Leaflet). | The build resumed from written progress notes. |
| **Parallel AI agents would have edited the same files.** | Each agent owns its files, and the shared UI is rethemed after the builder finishes. |
| **Agents shared one `web/.next` build folder.** One agent's build overwrote the output another agent's running server was serving, so its pages loaded stale CSS. | Agents that build or run the app work in their own isolated copies. |
| **Two agents' isolated copies collided** on the same folder name in the shared scratchpad. | Each agent now uses its own named copy: `webcopy-builder` (or `builder-verify-booking-rules`), `webcopy-brand`, `webcopy-payments` and `webcopy-voice`. The hardware agent's generic `webcopy` is deleted. |
| **Removing `PRICES.reservation` broke the landing page** in the middle of the retheme. | An alias kept the landing working until it moved to `RESERVATION_FROM_CENTS` and `feeRules()`. Then the alias was removed. |
| **Hot reload kept an old reservation engine.** The engine lives on `globalThis` to survive dev reloads, so a running dev server kept the old instance, without the engine's new methods. | The store key is versioned (`reservations_v2` in [server.ts](../web/lib/server.ts)), and bumping it starts a fresh store. The cost: the dev server lost its in-memory bookings once, at the rename. |

## Design

| What happened | What we did |
|---|---|
| **The first UI was judged poorly designed:** a bare full-screen map with a floating box, and no landing page or sign-in. | Full redesign: landing page → Clerk sign-in → onboarding → Explore → booking → history, plus the operator dashboard. |
| **The design skill banned the first font pick,** Plus Jakarta Sans. | Barlow, and then the real Ecurious fonts: Bebas Neue, Space Grotesk and JetBrains Mono. |
| **The first identity wasn't Ecurious's.** The green came from the challenge PDF and the yellow from the device photo. | Rethemed to the brand on ecurious.com ([decision D15](decisions.md)). |
| **The Firecrawl CLI wasn't logged in,** so it couldn't extract the brand. | The brand values were read from ecurious.com's own CSS with playwright-cli. |
| **ecurious.com doesn't show the reservation hardware.** It presents a charging marketplace (one card, every charger, best price). | We draw the hardware ourselves, and pitch reservations as part of the Ecurious app and card. |
| **A tab-bar "overlap" was a false alarm.** The screenshots were taken at the top of the page. | Measured every page scrolled to the bottom, and no fix was needed. |
| **Countdowns written as m:ss (12:30) looked like clock times.** | The header pill now shows the end time ("Held until 13:38"). The other countdowns are labelled as time left, next to the clock time ("12:30 left to arrive · arrive by 14:35"). See [D38](decisions.md). |

## Product and pricing

| What happened | What we did |
|---|---|
| **Security review: the camera webhook failed open.** With no secret configured, anyone could post a plate and open the bay. | It fails closed now, and the simulator lives on its own gated route ([D5](decisions.md)). |
| **Security review: anyone could cancel or finish someone else's reservation.** | A reservation token at first, then Clerk ownership ([D6, D7](decisions.md)). |
| **Security review of the pushed commit: the fallback check-in trusted the browser's location alone.** Faked coordinates could lower the arm from anywhere. | It now needs evidence from the bay: an unreadable plate read in the last 3 minutes, or the presence sensor once it's wired. Location is only an extra check ([D31](decisions.md)). |
| **A single-use Clerk sign-in token was printed in one tool output** during browser testing. | It had already been used, so it couldn't sign anyone in again, and the output was deleted. |
| **The meeting notes came through speech-to-text:** "50 minutes" (probably 15) and "notional fee" (probably no-show fee). | The agents flagged the ambiguities instead of guessing, and the team decided ([reservation-model.md](reservation-model.md)). |
| **The notes' tiers backfired:** a late cancellation (60% of the fee) cost more than a no-show (50%). Drivers would rather not show up than cancel. | The tiers are now shares of the no-show fee, so cancelling always costs less. |
| **The team rejected the first "+€5 on a second no-show" rule** as too much. | Replaced by the 50% no-show fee and the repeat no-show rule (prepay after 3 no-shows in the last 10 bookings). |
| **With "reserve now", the cheaper cancellation tiers can't be reached:** the slot starts at booking. | Documented. The tiers become meaningful with advance booking (planned). |
| **Electra dropped reservations in Feb 2026** because a reserved bay is "frozen" for drivers on site. | Our answer: the fee pays for the empty time, and the 15-min grace plus automatic release keep it short. |
| **Research gaps:** we found no German operator selling charger reservations today, and no hourly demand data. One claim about Monta couldn't be verified, so we didn't use it. | Demand pricing defaults to "normal" without data, and a demo control sets occupancy. |

## Booking v2 and the live demo

| What happened | What we did |
|---|---|
| **The live server's event names differ from its docs:** it sends `lock:status_changed` and `lock:car_presence_changed`. The docs say `status_change` / `vehicle_presence`, and our first parser followed the vendor dashboard (`lock:status_change`, `lock:car_presence`). | The parser maps the real names, which were seen live on 2026-10-24 ([ecurious-events.ts](../web/lib/ecurious-events.ts)). |
| **`lock-0001` was taken off the team,** and it hadn't worked anyway. | It's retired in code (`RETIRED_LOCKS`) and never called. `bw-1` and `bw-2` use `lock-0002` and `lock-0003`. |
| **A driver expected the arm to rise right after booking a later slot.** | That's by design: the arm rises at start − 10 min, so the bay stays usable until then. The booking screen now says when it will rise. |
| **"Pay" answered 409** during testing. | A leftover demo "car in bay" was blocking the slot. |
| **Several sessions and tools edited the same tree** (other Claude sessions, Codex, agents). Commits `cb78396` and `ea331a8` swept up other tools' work with `git add -A`. | File ownership per agent, and one session commits the whole tree. Lesson: stage explicit paths. |
| **A usage limit stopped three agents mid-task.** | The interrupted tasks were picked up again. |
| **The demo fallback server broke under Turbopack:** it runs from the stable commit `817b029` in a git worktree, and its symlinked `node_modules` broke the build. | An APFS clone of `node_modules` instead of a symlink. |
| **Security reviews on today's commits found four holes:** location-only fallback check-in, walk-up without a plate match, a demo payment the browser could choose, and an unauthenticated Vapi webhook whose secret also signed session tokens. | All four are fixed: camera evidence; one of the driver's own plates; payment decided on the server; a bearer secret plus a separate session secret ([D43](decisions.md), [D45](decisions.md), [D46](decisions.md)). |
| **Stripe isn't in v2 yet.** It's built and passed a live test-mode run (a €2.50 hold, €1.25 captured), but there was no time to wire it into the new engine. | The demo payment is used, and the keys are paused ([payments.md](payments.md)). |

## The Flutter port

| What happened | What we did |
|---|---|
| **A password sign-in from the app didn't sign in.** Clerk's "client trust" treats a new client as a new device and answers `needs_second_factor`, with a code by email. | After the password, the app asks Clerk for the email code and shows the code step. Clerk test addresses (`+clerk_test`) use the code `424242`. |
| **The Clerk Dart SDK can't sign in from a browser.** Its native mode sends `Authorization`, and Clerk refuses any request that has both `Origin` and `Authorization` (`origin_authorization_headers_conflict`). Browsers always send `Origin`. The SDK's own comment blames CORS, but the preflight passes; the request itself is refused. | Two sign-in paths behind one interface: `clerk_auth` on phones, and on web the official clerk-js (the same build the web app loads) through `mobile/web/clerk_bridge.js`. |
| **Google Fonts served WOFF subsets** to a browser user agent, which Flutter can't load on phones. | Fetched the full static TTFs with a plain user agent and bundled them (`mobile/assets/fonts`, SIL OFL). |
| **Clerk's Flutter UI package reads and writes files** for its cache, which breaks on web. | Used the plain Dart `clerk_auth` package with a shared_preferences store and our own brand-styled sign-in screen. |
| **GoingElectric sends `"network": false`** for a charger without a network, and the server passes it on, although its type says `network?: string`. The web hides it (React renders `false` as nothing); Dart's strict parse threw, and the map showed no chargers. | The app reads optional text as "a string, or nothing", with a test on that charger. |
| **Text overflowed on phones** in places the web wraps on its own: status chips, and a line in the landing page's phone mockup. | A widget test renders every screen and every booking state at 390×844 with the real fonts against a mock API, and fails on any overflow. |

