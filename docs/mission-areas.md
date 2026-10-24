# Our answers to the mission areas

_Last updated: 2026-10-24. Six areas chosen (the challenge asks for at least two). The numbers come from the code: [booking-rules.ts](../web/lib/booking-rules.ts) and [pricing.ts](../web/lib/pricing.ts). Research and sources: [reservation-model.md](reservation-model.md)._

Legend: **built** works in the prototype today. **Being wired:** the logic exists and the UI is being finished. **Pitch-only:** designed, not built.

## 1. No-Shows

- **The problem:** a reserved bay stands empty if the driver never comes. How long do you hold it, how do you notice, and how do you price that fairly?
- **Our answer:** a short, paid hold that releases itself, with reminders, and fees that always make cancelling cheaper than not turning up.

| Mechanism | Status | Where |
|---|---|---|
| 15-min arrival grace, then automatic release by a 5 s timer | Built | `expire()` in [reservation.ts](../web/lib/reservation.ts) |
| "Running late": +5 min once, for €0.50 | Built | `extend()` |
| No-show fee of 50% of the reservation fee, with the rest refunded | Built | `noShowFee()` |
| Repeat no-shows: a warning at 2 in the last 10 bookings. At 3 (within 90 days) the driver prepays and a no-show keeps the whole fee. | Built (engine). The warning in the reserve dialog is being wired. | `assessReliability()` |
| Cancellation: free within 2 min. After that, a share of the no-show fee that grows towards the start (0% at ≥24 h, 30%, 40%, 60%). | Built. With "reserve now" only the 60% tier is reachable. | `cancellationFee()` |
| Reminders: 1 h and 15 min before the session ends. Before the start: 1 day, 2 h, 15 min. | End reminders built (engine), UI banner being wired. Start reminders are pitch-only (advance booking). | `notificationSchedule()` |
| Waitlist: a freed bay goes to the next waiting driver for a 2-min priority window | Built | `notifyWhenFree()`, `offerToNextInLine()` |
| ETA / GPS-based no-show prediction | Pitch-only | – |

## 2. Blocked Bays

- **The problem:** another car (a combustion car, an EV not charging, an EV still charging) is in the reserved bay. Who notices, who's told, who's responsible?
- **Our answer:** the camera notices, the waiting driver loses nothing, and the operator is alerted and can resolve it.

| Mechanism | Status |
|---|---|
| A plate event from a car that isn't the booked one, in a reserved bay, **pauses the hold**. The time is given back when the bay clears. | Built |
| The driver sees "Another car is in your bay", with a **free cancel** and the **nearest public chargers** (GoingElectric) with Navigate | Built |
| An **operator alert** on the dashboard (with the plate, operator-only) **plus an email** (without the plate) | Built (email needs `RESEND_API_KEY`) |
| Resolved automatically when the camera sees the car leave, or by the operator ("Bay is clear"). The plate is erased on resolve. | Built |
| A car parked in the bay without any booking marks the bay occupied: no new reservations and no alert, because that's normal charging | Built |
| Classifying the blocker (combustion, idle EV, charging EV) from the charger's session status (OCPP) | Pitch-only |
| Escalation ladder (reminder → operator call → towing per the site's signage) | Pitch-only |

## 3. License Plate Recognition

- **The problem:** link a plate to a reservation, release the bay automatically, survive misreads, other cars and foreign plates, and stay GDPR-compliant.
- **Our answer:**

| Mechanism | Status |
|---|---|
| The plate comes from the driver's **own saved car**, added once with consent, never typed at booking | Built ([vehicles.ts](../web/lib/vehicles.ts)) |
| A match **releases the bay automatically**: the guard goes down and the status becomes `arrived` | Built |
| **Misread tolerance:** confusable characters (B/8, O/0, …) and one edit on plates of 6+ characters, compared only against the one active booking. Recorded as `exact` or `fuzzy`. | Built ([plates.ts](../web/lib/plates.ts)) |
| **Unreadable plate:** the app offers "I'm at the bay" (within 150 m) | Built. On site we'd prefer a code on the device display or a QR sticker. |
| **Different car today:** a second plate for this booking only, erased at the end | Built |
| **The booked car driving out** ends the session and bills overstay | Built |
| GDPR: plates erased when the booking ends, masked in the app (`MA•••34`), never in logs or emails | Built ([data-flows.md](data-flows.md#personal-data)) |
| Plate-triggered "plug & charge" (start the session at check-in) | Pitch-only. It needs the charger integration. |

## 4. Business Case and pricing

**Who pays:** the **driver** pays to reserve, and the **operator (CPO)** pays for blocked-bay alerts and the dashboard.

| Item | Price (code) | Rationale |
|---|---|---|
| Reservation, fast (DC, slot up to 2 h) | €2.50 at normal demand | 15 min empty × the DC idle fees Aral and Allego charge (€0.15–0.25/min) |
| Reservation, slow (AC, slot up to 4 h) | €1.50 at normal demand | 15 min × the AC idle fee EnBW and EWE Go charge (€0.10/min) |
| Demand multiplier | Quiet 0.8× · normal 1.0× · busy 1.5× · peak 2.0×, **never above €4.00** | Pulls bookings into idle hours. The cap is there because the mentor called €5 too much. |
| No-show | 50% of the fee (prepaid drivers: 100%) | The team's decision. It's always less than the fee. |
| Cancellation after 2 min | 0–60% of the no-show fee, by lead time | Always cheaper than a no-show, so drivers free the bay |
| Running late | €0.50 for +5 min, once | Same €0.10/min rate |
| Overstay | 15 min free, then €0.25/min (fast) or €0.10/min (slow), capped at €12 | Operators' existing idle-fee rates |
| **Bay Guard** (CPO plan) | €19 per bay per month | An hour of blocked DC bay loses about €12 of margin (our estimate), so two prevented hours a month pay for the plan |
| Revenue split | 70% of reservation fees to the CPO, 30% to the platform | Shown on the operator dashboard |

- **Examples:**
  - Fast bay, normal demand: €2.50. A no-show costs €1.25, and a late cancellation €0.75.
  - Fast bay at busy demand: €3.75.
  - Fast bay at peak: capped at €4.00.
- **Value:** the driver gets a guaranteed bay, with no detour or queueing. The CPO gets paid for held time, fewer blocked hours, and the data to prove it.
- **Payments** are a mock today. The recommendation is to bill fees with the next charging session (card fees are about €0.25 + 1.5% per payment).

## 5. Utilisation (operator dashboard)

- **The problem:** show that reservations raise utilisation instead of leaving bays empty, with KPIs a CPO trusts.
- **Built** (`/operator`, [operator.ts](../web/lib/operator.ts)), over the last 7 calendar days:
  - reservations, completion rate, no-show rate;
  - average time from booking to arrival;
  - blocked incidents and minutes;
  - camera vs fallback check-ins, and misreads matched;
  - reservation revenue and the CPO's share;
  - a reservations-per-day chart, live bay status, open alerts and the event log.
- **"Simulate a week"** (demo only) fills the KPIs with clearly labelled simulated data.
- **How utilisation goes up:** waitlist priority re-fills a freed bay within minutes, demand pricing moves bookings to quiet hours, and short holds plus automatic release limit empty time.
- **Pitch-only:** per-site occupancy from real sessions, which would feed demand pricing; week-over-week deltas; multi-site rollups.

## 6. Interoperability

- **The problem:** let other charging apps reserve the same bay, link to it smartly, and recognise app B's driver on site.
- **Our answer** (in progress, see [api.md](api.md)):
  - **OCPI 2.2.1-style commands** `RESERVE_NOW` / `CANCEL_RESERVATION` for partners (eMSPs), with partner tokens.
  - An **`ecurious_license_plate`** extension, so the camera recognises the partner's driver exactly like ours.
  - A **status endpoint** to poll, because we don't call partner-supplied callback URLs (an SSRF risk).
  - **Deep links** (`/bay/{id}`) so any app or website can show a "Reserve with Ecurious" button.
  - An **OpenAPI spec**.
- **Already built:** public read endpoints (`/api/state`, `/api/chargers`), and one backend shared by web, Flutter and partners.
- **Pitch-only:** OCPI roaming via hubs (Hubject, GIREVE), mapping onto OCPP `ReserveNow` on the charger, and universal or app links for the native app.

## Not chosen: New Use Cases

Pitch ideas only, not built:
- Retailers or hotels giving reserved charging as a perk (a voucher instead of the fee).
- Fleets booking bays for their drivers.
- Event parking.

They fit Ecurious's marketplace positioning ("one card, every charger").
