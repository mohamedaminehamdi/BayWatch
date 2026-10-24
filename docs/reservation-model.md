# Reservation and pricing model

How a reservation works and what it costs. Written for the team and the jury. The rules live in [`web/lib/booking-rules.ts`](../web/lib/booking-rules.ts) and are tested (`cd web && node --test lib/booking-rules.test.ts`). The app's "reserve now" flow uses them; advance booking of a fixed slot is planned. Prices were researched on 24 Oct 2026, and [S1]–[S18] point to the [sources](#where-the-numbers-come-from).

**The idea:** a reservation buys a guaranteed bay. The fee pays the operator for the minutes the bay stands empty while it waits for the driver. In February 2026 Electra dropped reservations for exactly that reason: to drivers on site, a reserved bay is a "frozen" bay [S8]. A short grace period, automatic release, cheap early cancellation and a no-show fee keep that frozen time short and paid for.

## At a glance

| Rule | Value |
|---|---|
| Types | Reserve now: fast (DC) up to 2 h or slow (AC) up to 4 h, starting at booking. Advance booking of a fixed slot is planned. |
| Reservation fee | Fast €2.50, slow €1.50 at normal demand. 0.8× to 2× with demand, never above €4.00. Shown before booking. |
| No-show fee | 50% of the reservation fee |
| Cancellation | Free within 2 min of booking, and 24 h or more ahead. Otherwise 30% to 60% of the no-show fee, rising as the start gets closer. |
| Arrival grace | 15 min after the start (with reserve now, after booking). After that the bay is released as a no-show. |
| Overstay | 15 min free after the end, then €0.25/min (fast) or €0.10/min (slow), at most €12 |
| Reliability | 3 no-shows in the last 10 bookings within 90 days: the fee is paid up front and not refunded on a no-show. Warning at 2. |
| Reminders | 1 h and 15 min before the end. With advance booking, also 1 day, 2 h and 15 min before the start. |

## Reservation types

**In the app: reserve now.** The driver picks fast or slow and an end time, and the slot starts when they book. As today, they then have 15 min to arrive.

| Type | Charger | Longest slot | Baseline fee | Overstay rate |
|---|---|---|---|---|
| `fast` | DC | 2 h | €2.50 | €0.25/min |
| `slow` | AC | 4 h | €1.50 | €0.10/min |

### Advance booking of a fixed slot (planned)

Pitch-only for now. The driver books a start and an end ahead of time. Fees, grace and overstay work as above, and the cancellation tiers by lead time apply in full. It needs three things:

**A slot schedule per bay with overlap checks.** Today the app holds one booking at a time. We propose a 15-min buffer after each slot (the overstay grace), so an overstaying car doesn't block the next booking.

**Pre-start reminders.** `notificationSchedule` already computes them. It skips any reminder that would be due at booking time, so reserve-now bookings get none. A booking made 3 h ahead gets no 1-day reminder, and one made 15 min ahead or less gets no start reminders at all.

| Key | When | Draft text (slot 14:00–15:30) |
|---|---|---|
| `starts_in_1d` | 1 day before the start | "Tomorrow 14:00–15:30, your bay at {site} is booked. Plans changed? Cancel in the app so another driver can charge." |
| `starts_in_2h` | 2 h before | "Your bay is held from 14:00. Can't make it? Cancel now so another driver can charge." |
| `starts_in_15m` | 15 min before | "Your bay is ready at 14:00. You have until 14:15 to arrive." |

**Device lock timing.** We need to decide when the device locks the bay: at the start, or earlier. Locking earlier freezes the bay for longer, and the fee would have to cover that. If a walk-in car is still there at the start, today's blocked-bay flow applies: the hold pauses and cancelling is free.

## Notifications

**In the app: end-of-session reminders.** Example: a fast slot 14:00–15:30.

| Key | When | Draft text |
|---|---|---|
| `ends_in_1h` | 1 h before the end | "Your slot ends at 15:30. Please leave the bay by 15:45." |
| `ends_in_15m` | 15 min before the end | "15 minutes left. From 15:45, idle time costs €0.25 a minute." |

- **Inside the slot only:** a 45-min slot gets only the 15-min reminder.
- **Checked at send time:** end reminders go out only once the car has arrived.
- **Pre-start reminders** come with [advance booking](#advance-booking-of-a-fixed-slot-planned).

## Arrival grace

A driver who arrives up to 15 min after the start keeps the booking. With reserve now, that means 15 min from booking, as today. The end time doesn't move, so arriving late shortens the session. At exactly start + 15 min they still count as on time. One moment later the bay is released and the no-show fee applies. If another car blocks the bay, the hold is paused, as in the app today.

Other services hold for a similar time: EVgo holds a reserved charger for 20 min [S6], and SHARE NOW holds a car for free for 20 min [S11].

## Overstay

The first 15 min after the slot ends are free, to unplug and leave. After that, every started minute costs the type's idle rate, up to €12 per booking.

| | Fast (DC) | Slow (AC) |
|---|---|---|
| Rate after the grace | €0.25/min | €0.10/min |
| Anchor | Allego HPC €0.246/min [S4] | EnBW, EWE Go €0.10/min [S1, S2] |
| Cap | €12 (EnBW's cap [S1]) | €12 |
| Leaving 40 min after the end | €6.25 | €2.50 |

## Fees

### Reservation fee

The fee is the baseline × the demand multiplier, capped at €4.00. It is fixed when the driver books and shown before they confirm, e.g. "€3.75 · busy time · never more than €4".

**The baseline is our estimate.** No German operator sells charger reservations today, so there is no market price to copy. The only priced offer we found is EVgo's in the US, at $3 [S6]. We price the bay standing empty through the 15-min arrival grace at the idle rates operators already charge:

| Type | Idle rate charged today | × 15 min | Baseline |
|---|---|---|---|
| Slow (AC) | €0.10/min: EnBW, EWE Go [S1, S2] | €1.50 | **€1.50**, today's app price |
| Fast (DC) | €0.15–0.246/min on DC: Aral, Allego [S3, S4] | €2.25–3.69 | **€2.50** |

For scale, €1.50 buys 22–36 min of city-centre street parking: €4.00/h in Hamburg [S9], €2.50/h in Munich [S10].

**Demand pricing:**

| Demand: forecast share of the site's bays in use during the slot | Multiplier | Fast | Slow |
|---|---|---|---|
| Quiet: under 30% | 0.8× | €2.00 | €1.20 |
| Normal: 30–70%, or no data yet | 1.0× | €2.50 | €1.50 |
| Busy: 70–90% | 1.5× | €3.75 | €2.25 |
| Peak: 90% and more | 2.0× | €4.00 (€5.00, capped) | €3.00 |

- **Demand** is whichever is higher: the share of bays already booked for the slot, or the site's own occupancy history for that weekday and hour. Time of day enters through that history.
- **No hard-coded rush hours.** We found no public data on when public charging peaks in Germany. The one large analysis (Monta, 1.5 M sessions) found a morning peak, but it doesn't say which chargers it covers and calls itself unrepresentative [S18].
- **2× at peak** follows Tesla, which doubles its idle fee from €0.50 to €1.00/min when a site is full [S5].
- **The €4.00 cap** stays below the €5 a mentor called too much.
- **The 0.8× quiet price is the utilisation lever:** it pulls charging into idle hours.
- **The tier edges** (30/70/90%) are our estimate.
- **In the demo,** a control sets the occupancy. Without it, the slot prices at 1.0×.

### No-show fee

The no-show fee is 50% of the reservation fee, rounded down to the cent, so it is always less than the fee itself. At booking we place a card hold for the fee. On arrival we take the full fee. On a no-show we take half and release the rest. A €2.50 booking costs €1.25 as a no-show.

EVgo goes the other way: $3, plus a $2 no-show fee, makes $5 [S6]. Our version is gentler on a one-off miss and strict only with repeat no-shows (see the [reliability rule](#reliability-rule)).

### Cancellation

| Cancelled | Share of the no-show fee | Fast (€2.50 fee) | Slow (€1.50 fee) |
|---|---|---|---|
| Within 2 min of booking (misclick), or 24 h or more before the start | 0% (free) | €0.00 | €0.00 |
| 2 h to 24 h before | 30% | €0.37 | €0.22 |
| 10 min to 2 h before | 40% | €0.50 | €0.30 |
| Under 10 min before, or after the start | 60% | €0.75 | €0.45 |
| Not cancelled (no-show) | 100% | €1.25 | €0.75 |

- **Reserve now:** the slot starts at booking, so after the 2-min misclick window every cancellation falls in the 60% tier. The earlier tiers apply once advance booking ships.
- **Bay blocked by another car:** cancelling is free, as today.
- **The percentages are shares of the no-show fee, not of the reservation fee.** That keeps cancelling cheaper than not turning up, so a driver who can't make it has a reason to say so and free the bay.
- **Edges:** exactly 24 h before is still free, and exactly 10 min before still counts as "10 min to 2 h".
- **Free 24 h ahead** matches EVgo [S6] and the usual restaurant window [S12]. German trade press also warns that a no-show clause without a fair free-cancellation window can be void [S12].
- **Other industries:**
  - Quandoo lets restaurants charge 20%, 50% or 100% for late cancellations [S13].
  - Restaurants charge €30–80 per person for a no-show [S12].
  - Hotels charge 90% of a room they can't resell [S14].
  - FREENOW charges €10 for a pre-booked ride cancelled within 60 min of pickup [S15].
  - Airlines just keep the fare [S16].

## Reliability rule

**Threshold: 3 no-shows in the driver's last 10 bookings, within 90 days.** The warning comes at 2.

- **What counts:** only bookings that reached their start, i.e. the driver arrived or was a no-show. Cancellations don't count either way, so booking and cancelling can't wash out no-shows.
- **On prepay:**
  - The full fee is charged at booking.
  - Showing up costs the same as for everyone else.
  - A no-show loses the whole fee instead of half.
  - Cancelling refunds the fee minus the normal cancellation fee.
- **So the rule costs a reliable driver nothing.**

| When | Exact message (the counts fill in) |
|---|---|
| 2 no-shows: shown on the booking screen | "Careful: you missed 2 of your last 10 bookings. One more no-show and you'll pay the reservation fee up front, with no refund if you don't arrive." |
| 3 or more: shown before paying | "You missed 3 of your last 10 bookings, so you now pay the reservation fee up front. If you don't arrive, it isn't refunded. This ends once fewer than 3 of your last 10 bookings are no-shows; no-shows drop off after 90 days." |

- **Fewer than 10 bookings:** the count adapts, e.g. "3 of your last 4 bookings".
- **Back to normal:** this happens automatically.
  - Each attended booking pushes older ones out of the last 10, and no-shows expire after 90 days.
  - Worst case, after 3 no-shows in a row: 8 attended bookings, or 90 days.
  - Support can reset it after a genuine problem, e.g. a breakdown or an app error.
- **Count, not model:** the notes mention a "model". We use a plain count instead. It fits in one sentence, uses only the driver's own outcomes, and is easy to defend under GDPR Art. 22.

## Worked examples

1. **Fast stop, on time.**
   - At 14:00 a driver reserves a fast bay until 15:30 at normal demand. The app shows **€2.50** and places a €2.50 card hold.
   - They arrive at 14:12 (deadline 14:15). Reminders go out at 14:30 and 15:15.
   - They leave at 15:40, inside the overstay grace, and pay **€2.50** plus energy.
2. **Busy evening, cancelled.**
   - At 18:00 a driver reserves a slow bay at 80% demand. That gets 1.5×: **€2.25**.
   - At 18:05 they cancel: 60% of the €1.12 no-show fee is **€0.67**. The bay is free 10 min sooner than a no-show would leave it, and cancelling within the first 2 min would have been free.
   - With advance booking (planned), cancelling 24 h or more ahead would be free, and cancelling 1 h ahead would cost €0.44 (40%).
3. **No-show at peak.**
   - A fast bay at 95% demand: 2.0× would be €5.00, capped at **€4.00**.
   - The driver isn't there within 15 min, so the bay is released and they pay **€2.00**. The other €2.00 of the hold is released.
   - It is their 2nd no-show in their last 10 bookings, so their next booking shows the warning.
4. **Driver on prepay overstays.**
   - After 3 no-shows in their last 10 bookings, a driver reserves a quiet slow bay (0.8×). The **€1.20** fee is charged at booking.
   - The slot ends at 20:00 and they leave at 20:40. That is 25 billable minutes × €0.10 = **€2.50**, so **€3.70** in total.
   - Had they not shown up, the €1.20 would have been kept. Had they cancelled after the first 2 min, €0.84 would have come back (€1.20 minus the €0.36 cancellation fee).

## Value for drivers and CPOs

| For | What they get |
|---|---|
| Drivers | A guaranteed bay for €1.20–4.00, with the price shown before booking. Cancelling within 2 min is free, and a reliable driver never pays more than the fee. |
| CPOs | Frozen time gets paid for: the fee covers the arrival grace, a no-show pays half, a repeat no-show pays everything. Cancellations and the 15-min release bring bays back early. CPOs get 70% of reservation revenue (`CPO_SHARE` in `pricing.ts`). |
| Utilisation | The cheaper quiet price moves charging into idle hours. Peak pricing rations guaranteed bays when walk-in demand is high. |

- **KPIs:**
  - no-show rate
  - minutes a bay stood reserved but empty, per booking
  - share of bookings where the driver arrives
  - utilisation by hour, before vs after launch
  - fee revenue per bay per month
- **Billing small fees:** add them to the next charging session or a monthly invoice, not as separate card payments. Stripe takes €0.25 + 1.5% per payment [S17], which is the whole of a €0.25 fee.

## GDPR

- **What the rule reads:** for each booking, the outcome (`completed`, `no_show`, `cancelled`) and when it ended, linked to the driver's account. It reads no plates (the app already erases them when a booking ends), no location, no vehicle data and nothing about other drivers.
- **Retention:** 90 days, then deleted ([Art. 5(1)(e)](https://gdpr-info.eu/art-5-gdpr/)). The rule ignores older outcomes even if deletion lags.
- **Purpose:** this rule and the driver's own booking history only (Art. 5(1)(b)).
- **Transparent:** the rule is in the booking terms, and the app shows drivers their own count. Drivers accept the fee terms actively at booking with a checkbox, as German practice requires for no-show clauses [S12].
- **No profiling model:** a fixed count, explained up front, with human review through support ([Art. 22](https://gdpr-info.eu/art-22-gdpr/)).
- **Invoices** fall under separate tax-law retention and are never read by the rule.

## Built vs pitch-only

| Item | Status |
|---|---|
| `booking-rules.ts` with tests: reservation fee, cancellation tiers, no-show fee, reliability rule, reminder schedule, arrival deadline, overstay fee and slot check | **Built** |
| Reserve now in the app: fast/slow types; demand pricing, with a demo control for occupancy; the 50% no-show fee; cancellation tiers; the reliability rule with prepay and warnings; end-of-session reminders; the overstay fee | **Built** |
| Advance booking of a fixed slot: a slot schedule with overlap checks, pre-start reminders, device lock timing | **Planned** (pitch-only) |
| Occupancy data from operators (e.g. OCPI), real card holds and payouts, push delivery to phones, a KPI dashboard for CPOs | **Pitch-only** |

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

1. **Scope:** the app does "reserve now", with these fees, demand pricing (a demo control sets occupancy), the 50% no-show fee, cancellation tiers, the reliability rule, end-of-session reminders and overstay. Advance booking of a fixed slot is planned.
2. **Cancellation percentages are shares of the no-show fee,** so cancelling always costs less than not turning up.
3. **Cancelling 24 h or more ahead is free.**
4. **Reliability:** 3 no-shows in the last 10 bookings within 90 days means prepay. The warning comes at 2.

## Open questions

1. **"50 minutes" after the reservation:** we read this as a 15-min overstay grace. Or did it mean the arrival grace? Both are 15 min now.
2. **Late cancellations:** should cancellations under 10 min count as no-shows for the reliability rule? Right now they don't.
3. **Prepaid drivers who cancel:** do they get a refund minus the normal fee (our default), or nothing back?
4. **Double idle fees:** if the operator bills its own blocking fee (e.g. EnBW's after 4 h [S1]), we skip ours.
5. **Demand data:** outside the demo, who supplies occupancy: the operator (e.g. through OCPI), or our own booking history?
6. **Advance booking (planned):**
   - Does the device lock the bay at the start or earlier?
   - The 1-day and 2-h reminders fire exactly at the 24-h and 2-h tier edges, so each one arrives just as the cheaper tier ends. Should they go out earlier (e.g. 26 h and 2.5 h ahead), so they can say "free to cancel until 14:00"?
   - How far ahead can drivers book (EVgo allows 2 weeks [S6]), and how many bookings can one driver hold at once?
