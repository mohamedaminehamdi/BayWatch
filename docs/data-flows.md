# Data flows

_Last updated: 2026-10-24. Fees follow [booking-rules.ts](../web/lib/booking-rules.ts). The duration picker and demand control are still being wired into the UI. The partner flow is in progress._

Participants used below:
- **Driver:** the web app.
- **API:** Next.js route handlers.
- **Engine:** [reservation.ts](../web/lib/reservation.ts).
- **HW:** the Ecurious adapter, a mock today.
- **Camera:** the bay camera via the Ecurious server webhook.

## 1. Reserve → arrive → charge → release

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant API
  participant C as Clerk
  participant E as Engine
  participant HW
  participant CAM as Camera
  D->>API: POST /api/reservations {vehicleId, payment demo}
  API->>C: load the driver's car (privateMetadata)
  API->>E: reserve(ownerId, plate, label, duration)
  E->>E: quote: fee by type and demand, reliability check
  E->>HW: reserve() · guard up
  E-->>D: reserved · arrive by start + 15 min · receipt line
  loop every 2 s
    D->>API: GET /api/state
  end
  CAM->>API: POST /api/plate-events {plate, in} + secret
  API->>E: plateEvent(plate, in)
  E->>E: samePlate(read, booked) gives exact or fuzzy
  E->>HW: release() · guard down
  E-->>D: arrived (camera)
  D->>API: POST /api/reservation/charge
  D->>API: POST /api/reservation/finish
  Note over E: or the camera sees the car leave (out)
  E->>E: overstay fee if past end + 15 min · plates erased · into history
```

If `hw.reserve()` fails, the reservation is rolled back (502). If `hw.release()` fails, the state is restored and the driver sees an error.

## 2. Misread or unreadable plate, and the fallback check-in

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant E as Engine
  participant CAM as Camera
  CAM->>E: plateEvent("MA81234", in)
  E->>E: not exact · same after confusables (B→8) · match is fuzzy
  E-->>D: checked in (camera, misread tolerated)
  CAM->>E: plateEvent("", in) · car seen, plate unreadable
  E-->>D: unreadableAt set · app offers "I'm at the bay"
  D->>E: POST checkin {lat, lng}
  E->>E: within 150 m of the bay and no other car in it?
  E-->>D: arrived (fallback) · coordinates not stored
```

Matching ([plates.ts](../web/lib/plates.ts)):
1. Exact match after normalising.
2. Otherwise, canonical confusable characters: O/Q/D→0, I→1, B→8, S→5, Z→2, G→6.
3. Otherwise, at most one edit for plates of 6 or more characters.

It's only ever compared against the one active booking, plus its optional "different car today" plate.

## 3. Blocked bay → alert → email → resolve

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver (reserved)
  participant E as Engine
  participant CAM as Camera
  participant M as Resend
  actor O as Operator
  CAM->>E: plateEvent("BXY987", in) · not the booked car
  E->>E: blocker set · hold paused (blockedSince) · alert opened with plate
  E->>M: email to OPERATOR_EMAILS, without the plate
  M-->>E: emailStatus sent, failed or skipped
  E-->>D: "Another car is in your bay" · timer paused · free cancel · nearest chargers
  O->>E: GET /api/operator · sees alert, plate, email status
  alt the car leaves
    CAM->>E: plateEvent("BXY987", out)
  else operator clears it
    O->>E: POST /api/operator/alerts/{id}/resolve
  end
  E->>E: expiresAt += paused time · alert resolved · plate erased
  E-->>D: hold resumes
```

With no booking, a car parking in the bay just marks it occupied. That's normal charging, so it raises no alert, and new reservations are refused until the car leaves.

## 4. No-show expiry and fees

```mermaid
sequenceDiagram
  autonumber
  participant T as Timer (5 s)
  participant E as Engine
  participant HW
  T->>E: expire()
  E->>E: reserved, not blocked, now > expiresAt?
  E->>HW: release()
  alt normal driver
    E->>E: refund line: 50% of the fee returned
  else prepaid (3 no-shows in last 10 bookings)
    E->>E: whole fee kept
  end
  E->>E: status no_show · plates erased · waitlist offered the bay
```

## 5. Waitlist and priority

```mermaid
sequenceDiagram
  autonumber
  actor A as Driver A (booked)
  actor B as Driver B
  participant E as Engine
  B->>E: POST /api/waitlist (bay busy)
  E-->>B: position 1
  A->>E: finish, cancel or no-show
  E->>E: priority = {B, now + 2 min}
  E-->>B: "The bay is held for you to book" banner
  Note over E: others get 409 "Held for a waiting driver" until it expires, then the next driver in line gets it
```

## 6. Fee and pricing calculation

```mermaid
flowchart TD
  A["Bay power ≥ 50 kW?"] -->|yes| F["fast · base €2.50 · max 2 h"]
  A -->|no| S["slow · base €1.50 · max 4 h"]
  F --> M
  S --> M
  M["Demand multiplier by occupancy<br/>under 30% quiet 0.8× · 30–70% normal 1.0×<br/>70–90% busy 1.5× · 90% or more peak 2.0×<br/>no data = normal"] --> CAP["min(fee, €4.00 cap)"]
  CAP --> R{"3+ no-shows in last 10<br/>(90 days)?"}
  R -->|yes| P["prepaid: no-show keeps 100%"]
  R -->|no| N["no-show keeps 50%"]
```

- **Cancellation:**
  - Free within 2 min of booking, or while the bay is blocked.
  - Otherwise a share of the no-show fee by lead time to the start: ≥24 h 0%, ≥2 h 30%, ≥10 min 40%, later 60%.
  - With "reserve now" the start is the booking time, so after 2 minutes it's always 60%.
- **Extension:** +5 min for €0.50, once.
- **Overstay:** 15 min free after the session end, then €0.25/min (fast) or €0.10/min (slow), capped at €12.
- The fee is fixed when booking. If demand changed since the driver saw the price, the engine answers 409 "the price is now €X" and they confirm again.

## 7. Operator KPIs

```mermaid
flowchart LR
  H["history (≤300) + current reservation<br/>+ alerts (≤100)"] --> W["weekStats: last 7 Berlin calendar days"]
  W --> K["reservations · completion rate · no-show rate · time to arrive<br/>blocked incidents and minutes · camera vs fallback · fuzzy matches<br/>revenue and 70% CPO share"]
  SIM["Simulate a week (SIMULATOR=1)<br/>seeded, labelled simulated"] --> H
```

## 8. Partner app reservation (OCPI-style, in progress)

```mermaid
sequenceDiagram
  autonumber
  participant P as Partner app (eMSP)
  participant API
  participant E as Engine
  participant CAM as Camera
  P->>API: POST /ocpi/2.2.1/commands/RESERVE_NOW + Token · ecurious_license_plate
  API->>E: reserve(owner partner:name:uid, plate, …)
  API-->>P: OCPI envelope · result ACCEPTED or REJECTED
  P->>API: poll the reservation status (token-protected)
  CAM->>API: plate event · the partner's driver is recognised by plate
```

Details and examples: [api.md](api.md).

## Personal data

| Data | Stored where | Who sees it | Erased when |
|---|---|---|---|
| Driver's cars (plate, nickname, consent time) | Clerk `privateMetadata`, server-only | The driver only | When the driver deletes the car or the account |
| Booked plate (and "different car" plate) | The engine, in memory | The owner as `MA•••34` only. The camera matching runs server-side. | **When the reservation ends**, for every outcome |
| Blocking car's plate | The alert, in memory | Operators only. Never in emails or the event log. | When the alert is resolved (by camera or operator) |
| Fallback-check-in location | Not stored | – | Used once for the 150 m check |
| Booking outcomes (status, times, fees) | History, in memory, capped at 300 | The owner. Operators as aggregates. | On restart. The reliability rule only looks back 90 days. |
| Event log | In memory, last 30 | Shown in the demo panel and the operator view | Rolling. Never contains plates or identities. |
| Clerk identity (email, name) | Clerk | The driver. The server checks operator emails. | Clerk account deletion |

Clerk is a US processor, so GDPR relies on its data processing agreement and standard contractual clauses. Partner apps collect their drivers' consent and need a data processing agreement with us ([api.md](api.md)).
