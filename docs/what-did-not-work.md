# What did not work

_Last updated: 2026-10-24. An honest log of what failed, surprised us or had to be redone. Newest entries are at the bottom of each section._

## Hardware, data and environment

| What happened | What we did |
|---|---|
| **The Ecurious API docs aren't public.** Web searches found nothing, and the brief says they're handed out on site. | Mocked the hardware behind 3 functions ([ecurious.ts](../web/lib/ecurious.ts)) and a webhook for plate events, so the real integration is one file. We have the team key but not the docs yet. |
| **The venue location is unknown.** A search for the hackathon venue found nothing. | The bay coordinates are a Berlin placeholder (`BAY_LAT`/`BAY_LNG`). "I'm at the bay" only works within 150 m, so it needs the real coordinates on site. |
| **The challenge PDF disappeared from the project folder.** It was never committed, and it was gone before any cleanup ran. | The full text is in [CHALLENGE.md](../CHALLENGE.md). |
| **No native mobile toolchain.** Xcode was installed but not active, and there was no Android SDK or Java. | Flutter runs in Chrome only. Native builds need `xcode-select` or Android Studio. |
| **Flutter can't reserve any more.** Reservations need a signed-in Clerk user since accounts were added. | Flutter shows the map and bay status for now. Next step: Clerk's Flutter SDK (still beta) with Bearer tokens. |
| **The GoingElectric data is dense:** 123 locations within 2 km of the bay, and up to 500 per request. | MapLibre clustering, and a list capped at the nearest ~50. |
| **Nominatim forbids search-as-you-type.** | Search runs on submit only. |
| **Resend delivers only to the account's own address** until a domain is verified. | Alerts always show on the dashboard. The email status reads sent, skipped or failed. |

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

## Design

| What happened | What we did |
|---|---|
| **The first UI was judged poorly designed:** a bare full-screen map with a floating box, and no landing page or sign-in. | Full redesign: landing page → Clerk sign-in → onboarding → Explore → booking → history, plus the operator dashboard. |
| **The design skill banned the first font pick,** Plus Jakarta Sans. | Barlow, and then the real Ecurious fonts (in progress). |
| **The first identity wasn't Ecurious's.** The green came from the challenge PDF and the yellow from the device photo. | Rethemed to the brand on ecurious.com ([decision D15](decisions.md)), in progress. |
| **The Firecrawl CLI wasn't logged in,** so it couldn't extract the brand. | The brand values were read from ecurious.com's own CSS with playwright-cli. |
| **ecurious.com doesn't show the reservation hardware.** It presents a charging marketplace (one card, every charger, best price). | We draw the hardware ourselves, and pitch reservations as part of the Ecurious app and card. |
| **A tab-bar "overlap" was a false alarm.** The screenshots were taken at the top of the page. | Measured every page scrolled to the bottom, and no fix was needed. |

## Product and pricing

| What happened | What we did |
|---|---|
| **Security review: the camera webhook failed open.** With no secret configured, anyone could post a plate and open the bay. | It fails closed now, and the simulator lives on its own gated route ([D5](decisions.md)). |
| **Security review: anyone could cancel or finish someone else's reservation.** | A reservation token at first, then Clerk ownership ([D6, D7](decisions.md)). |
| **The meeting notes came through speech-to-text:** "50 minutes" (probably 15) and "notional fee" (probably no-show fee). | The agents flagged the ambiguities instead of guessing, and the team decided ([reservation-model.md](reservation-model.md)). |
| **The notes' tiers backfired:** a late cancellation (60% of the fee) cost more than a no-show (50%). Drivers would rather not show up than cancel. | The tiers are now shares of the no-show fee, so cancelling always costs less. |
| **The team rejected the first "+€5 on a second no-show" rule** as too much. | Replaced by the 50% no-show fee and the repeat no-show rule (prepay after 3 no-shows in the last 10 bookings). |
| **With "reserve now", the cheaper cancellation tiers can't be reached:** the slot starts at booking. | Documented. The tiers become meaningful with advance booking (planned). |
| **Electra dropped reservations in Feb 2026** because a reserved bay is "frozen" for drivers on site. | Our answer: the fee pays for the empty time, and the 15-min grace plus automatic release keep it short. |
| **Research gaps:** we found no German operator selling charger reservations today, and no hourly demand data. One claim about Monta couldn't be verified, so we didn't use it. | Demand pricing defaults to "normal" without data, and a demo control sets occupancy. |
