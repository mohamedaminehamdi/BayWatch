# Reservation and pricing model (booking v2)

_Last updated: 2026-10-24. **Booking v2 replaces** the earlier reserve-now rules: the 50% no-show fee, the cancellation tiers as shares of the no-show fee, the reliability/prepay rule, the "+5 min" extension, and €0.25/€0.10 overstay after 15 min. The code is the source of truth: [web/lib/booking-rules.ts](../web/lib/booking-rules.ts) (the v1 section at its end is deprecated), with the engine in [schedule.ts](../web/lib/schedule.ts)._

**The idea:** a reservation buys a guaranteed bay at a chosen time. The fee pays the operator for the minutes the bay is held for the driver. In February 2026 Electra dropped reservations because, to drivers on site, a reserved bay is a "frozen" bay [S8]. A grid with short gaps, a firm arrival grace, a full no-show fee and cheap early cancellation keep that frozen time short and paid for.

## At a glance

| Rule | Value |
|---|---|
| Bays | **Every GoingElectric charger** (`ge-<id>`, guard simulated: "Demo: simulated guard"), plus **three Baywatch bays**: `bw-1` → `lock-0002`, `bw-2` → `lock-0003`, and `bw-3` with no lock yet |
| Grid | 15-min blocks, starting on :00, :15, :30 or :45 (Europe/Berlin). The current block can still be booked during its first 5 min |
| Gap | At least 10 min free between two sessions on a bay (on the grid: the next start is ≥ end + 15 min) |
| Horizon and limit | A start at most 60 days ahead. At most **3 upcoming bookings** per driver |
| Class (by max power) | **slow** < 50 kW: up to 4 h, 0.5× · **fast** 50–299 kW: up to 2 h, 1× · **ultra** ≥ 300 kW: up to 1 h, 1.5× |
| Reservation fee | **€5** (a standard, fast reservation) × class × demand, **never above €10**, fixed at booking |
| Demand | By time and place: weekdays 17:00–19:00 **busy** 1.5×, 22:00–06:00 **quiet** 0.8×, `HOLIDAYS` busy, otherwise normal. The demo's "Site demand" overrides it (Peak 2×) |
| Arrival grace | 15 min after the start, then it's a no-show |
| No-show | **100%** of the fee |
| Cancellation | Free within 2 min of booking, and ≥ 24 h ahead. Then **10%** (24 h – 30 min), **50%** (30 – 5 min), **80%** (< 5 min, until the arrival deadline). Free while the bay is blocked |
| Overstay | **5 free minutes** after the end, then **€0.30/min**, at most €12. Split 50:50 between operator and platform |
| Credits | A wallet per driver: **€5** when their bay is blocked (once per booking), and a **free first reservation** |
| Reminders | Six: the day before (if booked > 1 day ahead), start − 30 min ("live"), start − 5 min, end − 5 min, at the end, end + 5 min |

## Fees by class and demand

| Demand | Slow (AC) | Fast (DC) | Ultra (DC) |
|---|---|---|---|
| Quiet 0.8× | €2.00 | €4.00 | €6.00 |
| Normal 1× | €2.50 | **€5.00** | €7.50 |
| Busy 1.5× | €3.75 | €7.50 | €10.00 (cap) |
| Peak 2× (demo only) | €5.00 | €10.00 | €10.00 (cap) |

On 2026-10-24 the team set the standard reservation to **€5**, overriding the earlier €2.50 base and €4 cap. The cap is now €10.

Half cents always round down, in the driver's favour.

## Cancellation

Measured from the start time ([booking-rules.ts](../web/lib/booking-rules.ts) `cancelPercent`):

| When the driver cancels | Fee | Fast at normal demand (€5.00) |
|---|---|---|
| Within 2 min of booking (misclick) | free | €0.00 |
| ≥ 24 h before the start | free | €0.00 |
| 24 h – 30 min before | 10% | €0.50 |
| 30 – 5 min before | 50% | €2.50 |
| < 5 min before, until the arrival deadline | 80% | €4.00 |
| Not cancelled, not arrived (no-show) | 100% | €5.00 |
| While the bay is blocked by another car | free, plus €5 credit | €0.00 |

- **Free 24 h ahead** matches EVgo [S6] and the usual restaurant window [S12]. A no-show clause without a fair free window can be void [S12].
- The quote shows the whole schedule before paying (`cancelSchedule`), and the booking screen shows what cancelling would cost right now.

## Arrival, no-show and blocked bays

- **Arrive by** start + 15 min. After that the booking is a no-show: the whole fee is kept, and the bay goes back to everyone.
- **Live booking** starts 30 min before the start: the live card, a banner, and the reminder that cancelling now costs 50%.
- **Blocked bay:** from start − 10 min, a car other than the booked one in the bay blocks it (a real lock's sensor, or the demo's "car in bay" on a simulated bay). The driver is re-routed to the nearest free bays ("Book instead", Navigate), gets the **€5 credit** once per booking, may cancel for free, and the operator is alerted. If the bay frees up in time, the booking simply continues, and the arrival deadline moves by the blocked time.

## Overstay

- The slot ends on time. **5 free minutes** to leave, then **€0.30 a started minute**, at most **€12** (EnBW's cap [S1]).
- Billed on Finish, or when the car leaves (a real lock's sensor).
- Shared 50:50 between the operator and the platform in the KPIs.

## Walk-up

- A free bay with no booking starting within the next 30 min + the gap can be **unlocked on the spot**, free of charge, until the next booking's start − the gap.
- It needs evidence of being at the bay: the 150 m geofence, and on a real lock the camera reading **one of the driver's own registered plates** in the last 3 minutes.
- Reminders and the overstay fee apply as for a booking.

## Credits and the first reservation

- **Wallet:** `creditCents` in the driver's Clerk `privateMetadata`, applied automatically to the next reservation fee. The receipt shows "Credit used".
- **Free first reservation** for new drivers (`firstFree`), an acquisition offer.

## Value for drivers and CPOs

- **Drivers** pay a capped fee (€5 for a standard reservation) for a guaranteed bay at their time, with free early cancellation and a credit when the guarantee fails.
- **Operators (CPOs)** get paid for held time, a full no-show fee instead of an empty bay, half of the overstay fees, and fewer blocked bays. The Bay Guard plan (€19 per bay per month) adds alerts and the dashboard. More in [unit-economics.md](unit-economics.md).

## GDPR

- The plate is erased when a booking ends, shown masked, and never sent to the voice model.
- Credits and booking outcomes belong to the driver's own account. Coordinates are used once and never stored.

## Built vs pitch-only

- **Built:** everything above, in the engine and the app. Card payments (Stripe test mode, holds and capture) exist but aren't wired into booking v2 yet: the demo payment is used ([payments.md](payments.md)).
- **Pitch-only:** demand from real occupancy data, per-site holiday calendars, Web Push reminders, the physical LED on the device (the app shows a virtual one).

## Where the numbers come from

All figures were checked on 24 Oct 2026 unless marked otherwise.

| # | Source | Figure | Date |
|---|---|---|---|
| S1 | [EnBW mobility+ tariffs](https://www.enbw.com/elektromobilitaet/produkte/ladetarife) | Blocking fee €0.10/min after more than 4 h connected, max €12 per charging session | Live 10/2026 (tariff cards dated 01.12.2025) |
| S2 | [EWE Go tariff](https://www.ewe-go.de/ladetarif) | Partner stations only: €0.10/min after 4 h, max €24. Charging costs €0.52/kWh at EWE Go stations, €0.62 at partners. | Live 10/2026, undated |
| S3 | [Aral pulse tariffs](https://www.aral.de/de/global/retail/pulse/tarife-bezahlmethoden.html) | Third-party stations only: €0.15/min from 45 min on DC, 360 min on AC. Ad hoc €0.59/kWh AC, €0.69 DC ≤ 50 kW, €0.79 DC > 50 kW. | Live 10/2026 |
| S4 | [Allego overstay fee](https://www.allego.eu/overstay-fee/) | HPC only: €0.246/min in Germany, from 45 min, only for minutes not charging | Live 10/2026 |
| S5 | [AutoBild comparison of blocking fees](https://www.autobild.de/artikel/elektroauto-laden-ladesaeule-blockiergebuehr-oeffentliches-laden-21216583.html) | Tesla: €0.50/min after charging ends at a site at least 50% full, €1.00/min when full, from 5 min, no cap. IONITY: no blocking fee. | 22 Oct 2025 |
| S6 | [InsideEVs on EVgo Reservations](https://insideevs.com/news/510452/evgo-launches-reservation-program/) (US) | $3 per reservation, bookable up to 2 weeks ahead, held 20 min after the start. A no-show pays $2 more ($5 total). Free cancellation 24 h or more ahead. | 31 May 2021, may be outdated |
| S7 | [Monta help centre](https://monta.com/en/help-center/reserve-charge-point/) | The operator sets a per-minute reservation price and a maximum time. The driver pays for the reserved minutes, also when cancelling. | Live 10/2026 |
| S8 | [Electra newsroom](https://www.go-electra.com/fr/newsroom/ev-charging-avoid-waiting-at-stations/) | Reservations removed: « une place réservée est une place "gelée" » | 9 Feb 2026 |
| S9 | [City of Hamburg](https://www.hamburg.de/politik-und-verwaltung/behoerden/bvm/aktuelles/pressemeldungen/faire-gebuehrenanpassung-beim-parken-im-rahmen-der-inflationsentwicklung-1176196) | Street parking €4.00/h in the city centre (zone 1), €2.00–3.50/h in zones 2–4 | 19 May 2026 |
| S10 | [Abendzeitung München](https://www.abendzeitung-muenchen.de/muenchen/stadtviertel/parken-in-muenchens-altstadt-wird-teurer-art-712222) | Altstadt "blue zone" €2.50/h, Mon–Sat 8:00–23:00 | 10 Mar 2021, may be outdated |
| S11 | [berlin.de on SHARE NOW](https://www.berlin.de/en/getting-around/carsharing/6455533-5889084-share-now.en.html) | A car can be reserved for free for 20 min | Live 10/2026 |
| S12 | [Tageskarte on restaurant no-show fees](https://www.tageskarte.io/gastronomie/detail/no-show-gebuehren-in-der-gastronomie-worauf-wirte-achten-sollten.html) | €30–80 per person is usual. Free cancellation until 24 or 48 h before. „Fehlt eine faire Stornofrist, ist die No-Show-Klausel nichtig." Active consent needed. | 29 Apr 2025 |
| S13 | [Quandoo partner terms](https://restaurants.quandoo.com/de-de/geschaeftsbedingungen) | Restaurants choose a 100%, 50% or 20% fee and a minimum notice period (e.g. 60 min) | Sep 2024 |
| S14 | [RH Group hotel terms](https://revo-hospitality-group.com/wp-content/uploads/2025/09/AGB-Hotelaufnahmevertrag-DE.pdf) | Room not resold: 90% with or without breakfast, 70% half board, 60% full board. The guest may prove a lower loss. | Stand 08.09.2025 |
| S15 | [FREENOW fee schedule](https://www.free-now.com/de/gebuehrenordnung/) | €5 for a ride cancelled 5 min or more after acceptance. €10 for a pre-booking cancelled within 60 min of pickup. | Stand 01.06.2025 |
| S16 | [Ryanair refund policy](https://help.ryanair.com/hc/en-gb/articles/12896766243857-Refund-Policy) | No refund if the flight operated and you didn't travel. No separate no-show fee. | Search excerpt only, the page blocked our fetch |
| S17 | [Stripe pricing (DE)](https://stripe.com/de/pricing) | 1.5% + €0.25 per standard EEA card payment | 24 Oct 2026 |
| S18 | [electrive on a Monta analysis](https://www.electrive.net/2026/08/11/analyse-deutsche-laden-nicht-nach-feierabend-sondern-vor-allem-morgens/) | 1.5 M sessions (Jan–Jul 2026) at over 250,000 Monta-managed points. 21% start 6–8 a.m., against 12.4% at 6–8 p.m. Charger type unclear, not representative. | 11 Aug 2026 |

**Not found:**

- a German operator selling charger reservations today (a [2020 pilot at Stadtwerke Saarlouis](https://www.electrive.net/2020/01/29/stadtwerke-saarlouis-testen-reservierung-von-ladesaeulen) published no price)
- hourly demand data for public charging in Germany
- idle fees for Fastned and E.ON (not checked)

## Decisions (24 Oct 2026)

1. **Booking v2 replaces reserve-now:** grid bookings up to 60 days ahead, on every GoingElectric charger and the three Baywatch bays.
2. **The standard (fast) reservation costs €5**, capped at €10 with demand, overriding the earlier €4 cap.
3. **No-show is 100%** of the fee, so the reliability/prepay rule and the 50% no-show are gone.
4. **Cancellation** by time to the start: free ≥ 24 h or within 2 min, then 10/50/80%.
5. **Overstay:** 5 free minutes, then €0.30/min, cap €12, split 50:50.
6. **Credits:** €5 for a blocked bay, and a free first reservation.
7. **Removed:** the "+5 min" extension (the grid replaces it) and the €5 repeat-no-show charge.

## Open questions

1. Is the class threshold right (fast from 50 kW, ultra from 300 kW)?
2. Should the €10 cap scale with class, now that ultra at busy demand hits it?
3. Where does real occupancy data come from, to replace demand by time of day?
4. How is the €5 credit funded: by the operator whose bay was blocked, or by the platform?
