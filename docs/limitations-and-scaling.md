# Limitations and scaling

_Last updated: 2026-10-24. This is challenge deliverable 5._

## Limitations today

| Area | Limitation | Upgrade path |
|---|---|---|
| **Hardware** | The real client ([ecurious.ts](../web/lib/ecurious.ts)) is verified read-only: the bay list, bay details, the latest plate and the event stream. **Pending: the supervised phase-2 test** of everything that moves the arm, the camera's plate list and auto-lift. Until then the app runs the mock. | Run [phase 2](hardware-integration.md#phase-2-the-live-test-at-the-bay) with an operator, a spotter and a test car, then set `ECURIOUS_LIVE=1`. |
| **Camera plate list** | `ECURIOUS_WHITELIST` is off, because German plates may not be stored (unverified). Our own matching lowers the arm instead, a little later than the camera would. | Phase 2, step 3 decides. |
| **Hardware events** | The stream has no replay, so events missed while disconnected are gone. Only `connected` and `lock:heartbeat` have been seen live. The other event names come from the vendor dashboard's code. | `status()` re-reads over REST every 5 s. Phase 2 confirms the names. |
| **One bay** | One reservation at a time, for one configured bay (`BAY_*` env). | Key the engine by bay id: `location_id` / `evse_uid`, as OCPI already models it. |
| **State** | In memory and single process. A restart loses bookings, alerts and the waitlist. History is capped at 300. | A database such as Postgres (reservations, outcomes kept 90 days, alerts), and a job queue for timers and reminders. |
| **Hosting** | Needs one long-running `next start`. Serverless hosting would split the state. | Possible once state is in a database. |
| **Booking model** | "Reserve now" only, so the cheaper cancellation tiers are unreachable. | Advance booking: a slot schedule with overlap checks, pre-start reminders, and a decision on device lock timing ([reservation-model.md](reservation-model.md#advance-booking-of-a-fixed-slot-planned)). |
| **Payments** | Mock ("demo payment"). | A payment provider, billing reservation fees with the next charging session to avoid per-payment card fees. |
| **Demand pricing** | No real occupancy data, so normal demand unless the demo control sets it. | Occupancy from the site's own session history and the charger's status (OCPP). |
| **Fallback check-in** | It needs the camera to have seen the car (an unreadable read), with location as an extra check. The presence sensor isn't wired yet, so a car the camera misses entirely can't use the fallback. | Wire the presence sensor. A code on the device display or a QR sticker would be stronger still. |
| **Free cancellations** | Chained free 2-minute cancellations (book, cancel, book again) can keep the bay held, by a partner or a driver. | **Planned, not built:** a cap on free cancellations per partner and per driver, per hour. |
| **Reminders** | In-app banner plus a browser notification, and only while the page is open. | Push notifications in the native app. |
| **Flutter** | Chrome only, and it can't reserve (no Clerk yet). | Clerk's Flutter SDK (beta) with Bearer tokens, then iOS and Android builds. |
| **Accounts** | A temporary Clerk app (accountless dev keys). | Claim it (`npx clerk auth login`), then a production instance. |
| **Email alerts** | Resend's sandbox delivers only to the account's own address. | Verify a sending domain. |
| **Operators** | One email allowlist, no tenancy. | Clerk Organizations: one org per CPO, with roles and per-site access. |
| **Partner API** | Built, for one bay.<br>• Tokens are issued by hand.<br>• No `CommandResult` callbacks (SSRF).<br>• Partner links and rate-limit windows are in memory.<br>• A checked-in partner booking only ends when the camera sees the car leave. | • The OCPI Versions/Credentials handshake.<br>• Callbacks only to hosts registered there.<br>• A database for links.<br>• The rate limit at the API gateway.<br>• The charger's transaction-end event (OCPP) to close sessions. |
| **Data protection** | Cars are stored in Clerk, a US processor. | A data processing agreement and standard contractual clauses, or EU-hosted storage for plates. |
| **Search** | Place search on submit only (Nominatim policy). | A geocoding provider that allows autocomplete. |

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
  - Our team already has three camera bays. Keying the engine by bay id would let one server run all three.
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
- Which of the three bays is physically ours at the venue, and its coordinates. We need them for `ECURIOUS_LOCK_ID`, `BAY_LAT` / `BAY_LNG` and the 150 m check-in radius.
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
