# Limitations and scaling

_Last updated: 2026-10-24, booking v2. This is challenge deliverable 5._

## Limitations today

| Area | Limitation | Upgrade path |
|---|---|---|
| **Hardware** | Two real locks (`lock-0002`, `lock-0003`) drive `bw-1` and `bw-2`. `bw-3` has no lock yet, and the GoingElectric bays have a simulated guard. The physical LED has no API, so the app shows a virtual one. | More locks via `ECURIOUS_BAYS`. Each adapter call already takes a `lockId`. |
| **Hardware events** | The stream has no replay, so events missed while disconnected are gone. | `status()` re-reads over REST every 5 s per lock. |
| **State** | Every schedule, booking and alert is in memory, in one process. A restart loses bookings (cars and credits survive, in Clerk). | A database for bookings and outcomes, and a job queue for the 5 s tick and the reminders. |
| **Hosting** | Needs one long-running `next start`. Serverless hosting would split the state. | Possible once state is in a database. |
| **Payments** | Stripe test mode (holds and capture) is built and passed a live test, but **isn't wired into booking v2**. The demo payment is used, and the keys are paused for the demo. | Wire the hold into v2 bookings and the capture into the end of a session ([payments.md](payments.md)). |
| **Demand pricing** | By time of day and configured holidays, not by real occupancy | Occupancy from each site's own history and the chargers' status (OCPP) |
| **Simulated guards** | Every GoingElectric charger is bookable, but nothing physically holds those bays. The UI says "Demo: simulated guard". | A guard device per bay, or a CPO integration that reserves the connector (OCPP `ReserveNow`) |
| **Fallback check-in and walk-up** | They need hardware evidence on a real lock, plus the 150 m geofence (spoofable on its own). The placeholder coordinates are in Berlin. | Set `BAY_LAT`/`BAY_LNG` to the venue. A code on the device display, or a QR sticker. |
| **Reminders** | An in-app banner plus a browser notification, only while the app is open | Web Push through a service worker, or the native app |
| **Free cancellations** | The 3-upcoming limit caps hoarding, but chained free 2-minute cancellations can still keep a bay held | A cap on free cancellations per driver and per partner, per hour |
| **Credits** | Who funds the €5 blocked-bay credit (operator or platform) is undecided | Settle it in the CPO contract |
| **Voice** | Demo payment only (`VOICE_DEMO=1`). Phone calls carry no driver token and book for one demo account (`VOICE_DEMO_USER_ID`, unset by default), so anyone with the number could book, a "now" booking on a real lock included (flagged by the security review). | Before setting `VOICE_DEMO_USER_ID`: make phone calls quote-only, or let them book only simulated bays. Then a caller lookup and real payment |
| **Flutter** | A port of the web screens, so a web change needs the same change in Dart. Google sign-in is only in the Next.js web app (email + password or a code works). No push notifications or deep links yet. Native builds not yet run. | Build on Android and iOS; Clerk OAuth with a deep-link redirect; push via FCM/APNs; share copy and rule numbers from one source |
| **Accounts** | A temporary Clerk app (accountless dev keys) | Claim it (`npx clerk auth login`), then a production instance |
| **Email alerts** | Resend's sandbox delivers only to the account's own address | Verify a sending domain |
| **Operators** | One email allowlist, no tenancy | Clerk Organizations: one org per CPO |
| **Partner API** | Tokens issued by hand, no callbacks (SSRF), and links and rate limits in memory | The OCPI Credentials handshake, callbacks to registered hosts, and a database |
| **Data protection** | Cars and credits are stored in Clerk, a US processor | A data processing agreement and standard contractual clauses, or EU-hosted storage |
| **Process** | Several tools and sessions share one working tree | One owner per file, and explicit paths when committing ([what-did-not-work](what-did-not-work.md)) |

## Scaling to other apps, operators and locations

- **Other apps:**
  - The same backend serves the web app, Flutter and partners.
  - **Built:** partners book through OCPI-style commands with our plate extension, and drivers of any app are recognised by plate at the bay ([api.md](api.md)).
  - **Built:** the bay page `/bay/{id}` lets any app or website hand a driver over with a single link.
- **Other operators:**
  - Bay Guard is priced per bay, so it's easy to sell per site.
  - Each CPO gets its own org with alerts and KPIs.
  - The 70/30 revenue split and the fee rules are constants in one file per concern ([booking-rules.ts](../web/lib/booking-rules.ts), [pricing.ts](../web/lib/pricing.ts)), so they're easy to tune per contract.
- **Other locations and hardware:**
  - The hardware sits behind a 3-function adapter, and the real CC5S client fills those same functions. So another vendor's barrier, a parking lock, or an OCPP charger's own `ReserveNow` can plug in the same way.
  - Plate events reach the engine as a generic `plateEvent(plate, direction)`: from the Ecurious stream through the bridge, or from any camera through the webhook.
  - The engine already keys every schedule by bay id, and the adapter takes a `lockId`. More Baywatch bays are one `ECURIOUS_BAYS` entry each.
- **Roaming (pitch-only):**
  - GIREVE speaks OCPI. Our two commands already follow its Commands module. Add Versions, Credentials, Locations, Tariffs and CDRs, and a hub can expose Ecurious bays to every connected app, without separate integrations.
  - Hubject speaks its own OICP. Its remote reservation start and stop calls map onto the same two operations.
  - CPOs can forward each booking to the charger as OCPP `ReserveNow`, so the connector is reserved as well as the bay.
  - A native app would claim the bay links as iOS universal links and Android App Links.
  - Partner invoicing would bill partner apps for their drivers' fees.
  - Details: [api.md](api.md#roaming-outlook).
- **Marketplace fit:** ecurious.com positions Ecurious as "one card, every charger, best price". Reservations become a premium feature of that card and app, and Ecurious bays become the ones you can guarantee.

## Open items for the Ecurious mentors

**Answered:**
- **The API:** REST under `/api/v1`, with the team key in an `X-API-Key` header. It covers `GET /locks`, `lock`, `unlock`, `whitelist` and `keep-state`. Our team, "Baywatch", has three camera bays ([hardware-integration.md](hardware-integration.md#the-service)).
- **How plate events reach us:** a live Server-Sent Events stream at `/api/v1/events`, with `lock:`-prefixed event names. Plate reads come as `lock:photo_captured`, and the car sensor as `lock:car_presence`.

**Still open:**
- The venue's coordinates, for `BAY_LAT` / `BAY_LNG` and the 150 m check-in and walk-up radius.
- The hardware questions in [hardware-integration.md](hardware-integration.md#open-questions-for-the-ecurious-mentors):
  - the auto-lift timeout;
  - whether German plates work on the camera's list;
  - departure events;
  - keep-state;
  - the zero battery and signal readings.
- Whether the device can show a code or QR for the fallback check-in.
- Whether we can control or read the 200 kW charger, for plug & charge and session status.
- Permission to use the Ecurious wordmark (until then, text-only "Powered by Ecurious").

**Pending:** the supervised [phase-2 test](hardware-integration.md#phase-2-the-live-test-at-the-bay) at the bay.
