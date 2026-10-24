# Our answers to the mission areas

_Last updated: 2026-10-24, booking v2. Numbers come from [booking-rules.ts](../web/lib/booking-rules.ts), and the full model with sources is in [reservation-model.md](reservation-model.md). **Built** works today; **pitch-only** is designed, not built._

## 1. No-Shows

| Mechanism | Status |
|---|---|
| Book a slot on the 15-min grid, up to 60 days ahead, with a 10-min gap between bookings and at most 3 upcoming per driver (against hoarding) | Built |
| Six reminders: the day before, start − 30 min (the booking goes live), start − 5 min, end − 5 min, at the end, end + 5 min. Each is re-checked when sent. | Built (in-app banner + browser notification) |
| 15-min arrival grace, then a **100% no-show fee**, and the bay goes back to everyone | Built |
| Cancellation by time to the start: free within 2 min or ≥ 24 h ahead, then 10% / 50% / 80%. The quote shows the schedule up front. | Built |
| Web Push and GPS/ETA-based no-show prediction | Pitch-only |

## 2. Blocked Bays

| Mechanism | Status |
|---|---|
| From start − 10 min, a car other than the booked one in the bay blocks it (a real lock's sensor, or the demo's "car in bay") | Built |
| **Re-route:** "Your bay is occupied", with the nearest free bays to **Book instead** or Navigate | Built |
| A **€5 credit** to the driver's wallet (once per booking) and a free cancel. If the bay frees in time, the booking continues and the deadline moves. | Built |
| An operator alert on the dashboard and by email (real bays). The plate is shown to operators only, and erased on resolve. | Built |
| Classifying the blocker through the charger's session data (OCPP) | Pitch-only |

## 3. License Plate Recognition

| Mechanism | Status |
|---|---|
| **The real camera, live:** plate reads (`lock:photo_captured`) and the car sensor (`lock:car_presence_changed`) over SSE drive the engine | Built, on `lock-0002` and `lock-0003` |
| **The camera's own whitelist, on by default:** the booked plate is posted when the arm rises, so the camera lowers it for that car, and the list is cleared at the end. `wildcard` is never sent. | Built |
| Misread tolerance (confusable characters, one edit on 6+ characters), only against the bay's booking | Built |
| Fallback "I'm at the bay": camera or sensor evidence in the last 3 min, plus 150 m | Built |
| **Walk-up:** on a real lock, the camera must read one of the driver's own registered plates | Built |
| "Different car today" | Built |
| GDPR: plates erased at the end, masked, never in logs, emails or the voice model | Built |
| Plug & charge at check-in | Pitch-only |

## 4. Business Case and pricing

**Who pays:** the **driver** pays to book, and the **operator (CPO)** pays for Bay Guard.

| Item | Price | Rationale |
|---|---|---|
| Reservation fee | **€5** standard (fast) × class × demand, **cap €10** | Set by the team on 2026-10-24, over the earlier €4 cap |
| Class | slow ×0.5 (≤ 4 h), fast ×1 (≤ 2 h), ultra ×1.5 (≤ 1 h) | A held ultra bay costs the operator more |
| Demand | weekdays 17–19 h busy ×1.5, 22–06 h quiet ×0.8, holidays busy | Moves bookings to quiet hours |
| No-show | 100% of the fee | Pays for the frozen time |
| Cancellation | free ≥ 24 h or within 2 min, then 10/50/80% | Always cheaper the earlier, so drivers free the bay |
| Overstay | 5 free min, then €0.30/min, cap €12, split 50:50 | Keeps the next slot on time |
| Credits | €5 for a blocked bay; a free first reservation | Trust, and acquisition |
| **Bay Guard** (CPO) | €19 per bay per month | Alerts, KPIs, dashboard |

- **Examples:** a fast bay at normal demand costs €5; cancelling 1 h ahead costs €0.50. A slow bay at a busy hour costs €3.75, and an ultra bay at a busy hour hits the €10 cap.
- **Revenue split and payback:** [unit-economics.md](unit-economics.md).
- **Payments:** Stripe holds and capture are built and passed a live test-mode run (a €2.50 hold, €1.25 captured), but they're not wired into v2 yet. The demo payment is used ([payments.md](payments.md)).

## 5. Utilisation (operator dashboard)

- **Per real bay:** status, alerts, and the hardware panel (guard, sensor, health, "Lower the arm").
- **7-day KPIs:** reservations, completion and no-show rates, time to arrive, blocked minutes, camera vs fallback check-ins, misreads matched, revenue and the CPO share, **credits issued, walk-ups and the overstay split**.
- **How utilisation goes up:**
  - Booking ahead fills the day.
  - Walk-up uses the gaps between bookings.
  - Demand pricing moves bookings to quiet hours.
  - Re-routing keeps a blocked driver charging nearby.

## 6. Interoperability

| Mechanism | Status |
|---|---|
| OCPI 2.2.1-style `RESERVE_NOW` / `CANCEL_RESERVATION`. `location_id` is any bay id (`bw-N` or `ge-<id>`), with optional `ecurious_start` (on the grid) and `ecurious_blocks`. | Built |
| The plate and consent extensions, so the camera recognises a partner's driver | Built |
| Final answers plus a status endpoint to poll (no callbacks: SSRF). Hardware refusals come back as REJECTED with the reason. | Built |
| Tokens, rate limit, idempotent retries, per-driver-token ownership | Built |
| The public bay page `/bay/{id}`, and deep links | Built |
| **Voice:** "Hey Siri, call Baywatch", or the in-app mic, through Vapi | Built ([voice-booking.md](voice-booking.md)) |
| Roaming hubs (GIREVE: OCPI Versions/Credentials/Locations/Tariffs/CDRs; Hubject: OICP), OCPP `ReserveNow` forwarding, universal links, partner invoicing | Pitch-only |

## Not chosen: New Use Cases

Pitch ideas only: retail or hotel perks (a credit instead of the fee), fleets booking for their drivers, and event parking. The credit wallet built for blocked bays would carry them.
