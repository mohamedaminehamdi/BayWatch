# Limitations and scaling

_Last updated: 2026-10-24. This is challenge deliverable 5._

## Limitations today

| Area | Limitation | Upgrade path |
|---|---|---|
| **Hardware** | The Ecurious server is **mocked** ([ecurious.ts](../web/lib/ecurious.ts)). The live cycle on the real bay depends on the on-site API docs. | Replace the three functions with HTTP calls (`ECURIOUS_API_KEY`), and map the camera's events onto `{plate, direction}`. |
| **One bay** | One reservation at a time, for one configured bay (`BAY_*` env). | Key the engine by bay id: `location_id` / `evse_uid`, as OCPI already models it. |
| **State** | In memory and single process. A restart loses bookings, alerts and the waitlist. History is capped at 300. | A database such as Postgres (reservations, outcomes kept 90 days, alerts), and a job queue for timers and reminders. |
| **Hosting** | Needs one long-running `next start`. Serverless hosting would split the state. | Possible once state is in a database. |
| **Booking model** | "Reserve now" only, so the cheaper cancellation tiers are unreachable. | Advance booking: a slot schedule with overlap checks, pre-start reminders, and a decision on device lock timing ([reservation-model.md](reservation-model.md#advance-booking-of-a-fixed-slot-planned)). |
| **Payments** | Mock ("demo payment"). | A payment provider, billing reservation fees with the next charging session to avoid per-payment card fees. |
| **Demand pricing** | No real occupancy data, so normal demand unless the demo control sets it. | Occupancy from the site's own session history and the charger's status (OCPP). |
| **Fallback check-in** | Browser geolocation can be spoofed. | A code on the device display or a QR sticker on the bay. |
| **Reminders** | In-app banner plus a browser notification, and only while the page is open. | Push notifications in the native app. |
| **Flutter** | Chrome only, and it can't reserve (no Clerk yet). | Clerk's Flutter SDK (beta) with Bearer tokens, then iOS and Android builds. |
| **Accounts** | A temporary Clerk app (accountless dev keys). | Claim it (`npx clerk auth login`), then a production instance. |
| **Email alerts** | Resend's sandbox delivers only to the account's own address. | Verify a sending domain. |
| **Operators** | One email allowlist, no tenancy. | Clerk Organizations: one org per CPO, with roles and per-site access. |
| **Partner API** | In progress. No async OCPI `CommandResult` callbacks (SSRF). | Per-partner pre-registered callback URLs, or roaming hubs. |
| **Data protection** | Cars are stored in Clerk, a US processor. | A data processing agreement and standard contractual clauses, or EU-hosted storage for plates. |
| **Search** | Place search on submit only (Nominatim policy). | A geocoding provider that allows autocomplete. |

## Scaling to other apps, operators and locations

- **Other apps:**
  - The same backend already serves the web app, Flutter and (soon) partners.
  - Partners book through OCPI-style commands with our plate extension, and drivers of any app are recognised by plate at the bay ([api.md](api.md)).
  - Deep links (`/bay/{id}`) let any app or website hand a driver over with a single link.
- **Other operators:**
  - Bay Guard is priced per bay, so it's easy to sell per site.
  - Each CPO gets its own org with alerts and KPIs.
  - The 70/30 revenue split and the fee rules are constants in one file per concern ([booking-rules.ts](../web/lib/booking-rules.ts), [pricing.ts](../web/lib/pricing.ts)), so they're easy to tune per contract.
- **Other locations and hardware:**
  - The hardware sits behind a 3-function adapter, so another vendor's barrier, a parking lock, or an OCPP charger's own `ReserveNow` can plug in the same way.
  - Plate events are a generic `{plate, direction}` webhook.
- **Roaming:**
  - OCPI is what roaming hubs (Hubject, GIREVE) speak.
  - Once the commands are on our side, a hub can expose Ecurious bays to every connected app, without separate integrations.
- **Marketplace fit:** ecurious.com positions Ecurious as "one card, every charger, best price". Reservations become a premium feature of that card and app, and Ecurious bays become the ones you can guarantee.

## Open items for the Ecurious mentors

- The API docs: endpoints for reserve, release and status, plus auth. (We have the team key, `ECURIOUS_API_KEY`.)
- How plate events reach us (webhook, polling or a live connection), and what one event contains.
- Whether the device can show a code or QR for the fallback check-in.
- Whether we can control or read the 200 kW charger, for plug & charge and session status.
- The test bay's coordinates, for `BAY_LAT` / `BAY_LNG` and the 150 m check-in radius.
- Permission to use the Ecurious wordmark (until then, text-only "Powered by Ecurious").
