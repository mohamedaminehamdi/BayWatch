# Data flows

_Last updated: 2026-10-24, booking v2. The engine is [schedule.ts](../web/lib/schedule.ts), with a tick every 5 s ([server.ts](../web/lib/server.ts)). Fees come from [booking-rules.ts](../web/lib/booking-rules.ts), and the lock calls go through [ecurious.ts](../web/lib/ecurious.ts)._

Participants below:
- **Driver:** the web app.
- **Engine:** the schedule.
- **Lock:** the Ecurious adapter, in live mode. A simulated bay keeps the same states in memory, with no calls.
- **Bridge:** the live event stream → the engine ([ecurious-bridge.ts](../web/lib/ecurious-bridge.ts)).

## 1. Book → arrive → charge → leave (a bay with a real lock)

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant API
  participant E as Engine
  participant L as Lock (Ecurious)
  participant BR as Bridge
  D->>API: GET /api/bays/bw-1/quote?start&blocks
  API-->>D: fee (€5 × class × demand, cap €10) · credit used · cancel schedule
  D->>API: POST /api/reservations {bayId, start, blocks, vehicleId, priceCents, acceptFees}
  API->>E: book: grid, gap, 60 days, 3 upcoming, price unchanged? · payment decided server-side
  E-->>D: upcoming
  Note over E: tick every 5 s
  E->>L: start − 10 min (at once for a slot starting sooner): bay online and vacant? · lock {cancelAutoLift} · whitelist [booked plate]
  Note over E,D: start − 30 min: live (card, banner, reminder)
  BR->>E: lock:photo_captured (booked plate) · camera lowers the arm itself (whitelist)
  E->>L: unlock {cancelAutoLift} if still up · whitelist cleared
  E-->>D: arrived (camera)
  D->>API: POST …/charge, then …/finish
  BR->>E: lock:car_presence_changed vacant for 10 s · car left
  E->>E: idle fee after 5 free min (€0.30/min, cap €12) · plate erased · history
  E->>L: lock {cancelAutoLift} · the arm is up again between sessions
```

- **A refused raise** (a car over the arm, an offline bay) at booking time rolls the booking back: 502 `The bay could not be reserved: <reason>`.
- **Before the start:** reminders at the day before (if booked > 1 day ahead), start − 30 min and start − 5 min.
- **During the session:** reminders at end − 5 min, at the end and at end + 5 min. Each is re-checked when sent.

## 2. Misread or unreadable plate, and the fallback check-in

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant E as Engine
  participant BR as Bridge
  BR->>E: photo_captured "MA81234" · not exact, confusables match (B→8) · fuzzy
  E-->>D: arrived (camera, misread tolerated)
  BR->>E: car_presence_changed occupied, no readable plate
  E-->>D: carAtBay · "I'm at the bay" offered
  D->>E: POST …/checkin {lat, lng}
  E->>E: camera or sensor saw a car in the last 3 min? · within 150 m?
  E-->>D: arrived (fallback) · coordinates not stored
```

A driver's location alone never lowers an arm.

## 3. Blocked bay → re-route + €5 credit

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver (booked)
  participant E as Engine
  participant M as Resend
  actor O as Operator
  Note over E: from start − 10 min, every tick
  E->>E: bay occupied by another car (real sensor, or demo "car in bay") · blockedSince
  E-->>D: "Your bay is occupied" · nearest free bays: Book instead, Navigate · free cancel
  E->>E: €5 credit to the driver's wallet, once per booking
  E->>M: operator alert email (real bays), without the plate
  O->>E: sees the alert, resolves it, or the car leaves
  E->>E: if before the arrival deadline: booking continues · deadline + blocked time
```

## 4. Walk-up ("Unlock now")

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver at the bay
  participant E as Engine
  participant L as Lock
  D->>E: POST /api/bays/{id}/unlock {lat, lng}
  E->>E: free, no booking within 30 min + gap? · within 150 m?
  E->>E: real lock: camera read one of the driver's own plates in the last 3 min? (403 otherwise)
  E->>L: unlock {cancelAutoLift}
  E-->>D: walkup · free until the next booking's start − gap
  Note over E: reminders and the idle fee apply · car leaves · arm up again
```

## 5. No-show

- **The deadline:** start + 15 min, moved by any blocked time.
- **When it passes:** the driver pays **100%** of the fee, the booking becomes `no_show`, the plate is erased, and a real arm goes back up for the next driver.

## 6. Fee calculation

```mermaid
flowchart TD
  P["Bay power"] -->|"< 50 kW"| S["slow · ×0.5 · up to 4 h"]
  P -->|"50–299 kW"| F["fast · ×1 · up to 2 h"]
  P -->|"≥ 300 kW"| U["ultra · ×1.5 · up to 1 h"]
  S --> D
  F --> D
  U --> D
  D["Demand at the start, Europe/Berlin<br/>weekdays 17–19 h busy ×1.5 · 22–06 h quiet ×0.8<br/>HOLIDAYS busy · demo override (Peak ×2)"] --> C["€5 × class × demand · cap €10"]
  C --> W["minus credit: €5 blocked-bay credits, or a free first reservation"]
```

- **Fixed at booking.** A different quote at Pay time is a 409, "The price is now €X".
- **Table by class and demand:** [reservation-model.md](reservation-model.md#fees-by-class-and-demand).

## 7. Voice booking

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver (mic in the app)
  participant APP as App
  participant V as Vapi
  participant API as /api/voice/vapi
  participant E as Engine
  APP->>APP: POST /api/voice/session · 15-min token (VOICE_SESSION_SECRET)
  D->>V: "Book bay 1 now for an hour"
  V->>API: quote_reservation + Bearer VAPI_BEARER_SECRET + token in metadata
  API-->>V: the quote, read back to the driver
  D->>V: "Yes"
  V->>API: confirm_reservation (same quote twice = same booking)
  API->>E: reserve for the driver named in the token · demo payment
  E-->>V: booked · "now" can raise a real arm
```

- **Phone calls** ("Hey Siri, call Baywatch") book for `VOICE_DEMO_USER_ID`, or are sent to the app.
- **Plates** never go to the voice model.
- **Details:** [voice-booking.md](voice-booking.md).

## 8. Partner app reservation

A partner sends `RESERVE_NOW` with `location_id` = bay id, the plate and consent, an optional `ecurious_start` and `ecurious_blocks`, and the fee its driver accepted. The answer is final (ACCEPTED, or REJECTED with the reason, including hardware refusals), and the partner polls the status route. The driver checks in by plate like any other. See [api.md](api.md).

## 9. Hardware events

| Event (live server) | Bridge → engine |
|---|---|
| `lock:photo_captured` | A plate read: the booked car checks in, or another car blocks the bay. On a free bay it's kept for 3 min as walk-up evidence. |
| `lock:car_presence_changed` occupied | Car in the bay: check-in evidence, or a blocker |
| `lock:car_presence_changed` vacant for 10 s | The car left: the session ends with any idle fee, and the arm goes up again |
| `lock:status_changed` | Arm position, for the cached status |
| `lock:heartbeat` | Health and battery |

The documented names were `status_change` and `vehicle_presence`. The live server sends the `_changed` forms, which the parser has handled since 2026-10-24 ([what-did-not-work](what-did-not-work.md)).

## Personal data

| Data | Stored where | Who sees it | Erased when |
|---|---|---|---|
| Drivers' cars (plate, nickname, consent time) | Clerk `privateMetadata` | The driver only | When the car or account is deleted |
| Credit wallet (`creditCents`, `firstFree`) | Clerk `privateMetadata` | The driver | With the account |
| Booked plate (and "different car" plate) | The engine, in memory | The owner, masked | **When the booking ends** |
| Booked plate on the camera's own list | The vendor's camera | The camera | Cleared at the end of the booking |
| Camera reads (walk-up evidence) | In memory, at most 3 min | Nobody | After 3 min |
| Blocking car's plate | The alert, in memory | Operators only, never emailed | On resolve |
| Locations (check-in, walk-up) | Not stored | – | Used once for the 150 m check |
| Voice calls | Vapi | – | Plates are never sent to the voice model |
| Booking outcomes | In memory | The owner; operators as aggregates | On restart |
