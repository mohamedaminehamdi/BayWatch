# BayWatch research report — 24 October 2026

> Original research draft from GPT-6.1 Sol, 24 October 2026. Completed before the repository was cloned; implementation assumptions are not a code audit. The companion Opus report subsequently confirmed that the shorter Jina extraction was truncated and that the fee and blocked-bay sections remained in Notion.

**Recommendation:** Keep the long-distance charging story, but define BayWatch as a **protected-bay reservation service with verified arrival and recovery when something fails**. The current plan combines a credible hardware demonstration with several unvalidated assumptions about charging duration, capacity, fees and integrations.

No Notion page, app code, account, provider setting or external resource was changed.

## Freshness and challenge verification

I retrieved the public [BayWatch plan](https://www.notion.so/BayWatch-4032e6d9e3bb8033b730de17ef7f7b33) through Agent Reach’s Jina Reader route at **13:20 CEST**, then again during **13:22:43–13:22:52 CEST** on 24 October 2026.

The second extraction added **“verification of user through biometric or passcode”** after vehicle-plate entry. Otherwise, the extracted substantive plan was unchanged. Both extractions ended with profile address and card-payment notes. The previously observed overstay, cancellation, rerouting and compensation sections were **absent from these extractions**; that does not establish that collaborators deleted them. Jina’s displayed “Published Time” was **9 July 2026**, which is not reliable evidence of Notion’s last edit.

The fresh [Ecurious challenge](https://sun-weather-eb6.notion.site/Ecurious-Challenge-detailed-3fe8e035358980409b1efb374df7d96d) confirms:

- GoingElectric-based public charging discovery.
- Mandatory **app ↔ Ecurious server ↔ provided physical hardware** integration.
- A demonstrated **reserve → plate-based arrival/check-in → charge → release** cycle.
- Documentation of architecture, API calls, data flows, decisions, tools, failures and limitations.
- Answers to **at least two** mission areas; covering all seven is the team’s additional ambition.
- Polish is a bonus.

The page exposes the filename `Ecurious_Challenge_Watt_the_Hack-3.pdf`, 544.3 KiB, but neither the rendered extraction nor link summary exposed a downloadable attachment URL. I verified the page text, **not a separately downloaded full PDF**.

The journey-driver focus, all-seven-mission ambition and booking fields supplied in the interview are treated below as **accepted provisional decisions**, not as statements already present in Notion.

## The eight highest-priority findings

1. **A protected parking bay is different from a working charger.** BayWatch can prevent another vehicle occupying the space while the connector is faulted, incompatible, power-limited or unavailable to the driver’s payment method. Present these as separate conditions.

2. **Two hours is a weak universal default for journey DC charging.** European measured sessions and existing arrival-reservation products support testing much shorter periods. They do not establish one correct duration for every charger.

3. **Fifteen-minute calendar steps and fifteen-minute empty gaps are different rules.** A mandatory empty gap can materially reduce capacity. The plan currently conflates them.

4. **Sixty-day advance booking is operationally much harder than a short arrival hold.** It creates commitments across unknown maintenance, charging demand, arrival changes and preceding overstays.

5. **Reservations need not increase productive utilisation.** They can improve arrival certainty while reducing charging time through holds, no-shows and buffers. Both effects belong in the business case.

6. **GoingElectric’s published terms constrain the data architecture.** A generic server-side cache/proxy cannot be assumed permissible.

7. **Current OCPI has more than immediate reservations.** OCPI 2.3.0 includes an optional **Bookings module** for calendars, scheduled bookings and access information including plates. Claiming that OCPI only supports `RESERVE_NOW` would be outdated.

8. **“€50 hardware” and “1–5% charging revenue” are unverified commercial inputs.** Neither establishes installation cost, margin, ownership, recurring costs or an enforceable commission entitlement.

## European and German benchmarks

These are provider-specific examples, not interchangeable market rules. All were accessed on 24 October 2026; undated pages may change.

| Product and jurisdiction | Verified behaviour | Implication |
|---|---|---|
| **Mercedes-Benz Charging Hubs, German customer information** | A charging point can be held for **15 minutes**. Eligibility depends on vehicle/digital services. A support article updated **21 May 2025** says reservations are currently free and unused reservations incur no penalty. | Arrival holds already exist; charging a fee requires a distinguishable benefit. |
| **Qwello Germany, AC** | Eligible own-network stations can be reserved in-app for **15 minutes**. The German FAQ reviewed does not establish a reservation price. | Do not transfer another country’s price to Germany. |
| **Qwello Sweden, AC** | **10 SEK for 15 minutes**, with the driver within a 15-minute drive. If the reserved space is blocked, the reservation fee is refunded and another reservation can be made free while it remains active. | A useful operational benchmark for blocked-bay recovery. |
| **incharge Greece, selected DC locations** | Premium users can reserve immediately or schedule within **eight hours**. Reservation capacity is **one quarter** at eligible sites with at least four DC chargers. Published cancellation charges: **€1 off highways / €3 on highways**; no-show: **€3 / €6**. | Limited reserved inventory and shorter horizons are credible alternatives to reserving every bay. |
| **ChargePoint, UK-facing queue documentation** | Drivers join a queue when full, accept an offered space and receive a temporary hold. Site owners configure policies. | A queue is a different product from a future timed booking. |

Sources: [Mercedes reservation function](https://www.mercedes-benz.de/passengercars/services/charging/mb-charge-public-card-stations-network.html), [Mercedes eligibility and fees](https://support.charge.mercedes-benz.com/hc/de-de/articles/35404337776785-Unter-welchen-Voraussetzungen-kann-ich-einen-Ladepunkt-an-einem-Mercedes-Benz-Charging-Hub-reservieren), [Qwello Germany](https://qwello.de/en/faqs), [Qwello Sweden](https://qwello.se/en/support), [incharge](https://www.incharge.gr/en/drivers-club/), [ChargePoint UK](https://www.chargepoint.com/en-gb/drivers/waitlist-faq).

There is no single European idle-fee standard:

- Tesla’s German support page describes a congestion fee at busy Supercharger sites when a charging threshold—typically 80%—is reached or charging ends. It provides **five minutes’ grace**, lists a typical German rate of **€0.50/minute**, and warns of location variation up to €1/minute.
- EnBW mobility+ publishes **€0.10/minute after four hours connected**, capped at **€12 per session**, including DC.
- Aral pulse distinguishes own-network charging from roaming: its reviewed page says no own-network blocking fee applies through its specified direct methods, while selected third-party stations can trigger **€0.15/minute after 45 minutes DC or 120 minutes AC**.

These fees use different triggers. None validates a BayWatch overstay rule automatically. [Tesla](https://www.tesla.com/de_de/support/charging/supercharger/fees), [EnBW](https://www.enbw.com/service/faq/e-mobilitaet/blockiergebuehr/), [Aral pulse](https://www.aral.de/de/global/retail/pulse/tarife-bezahlmethoden.html).

EnBW’s FAQ explicitly says advance charger reservation is unavailable in its app. That supports a genuine product gap, but not proof of willingness to pay for BayWatch. [EnBW FAQ](https://www.enbw.com/service/faq/e-mobilitaet).

## Charging duration and capacity

A European study published **6 July 2026**, using Czech 2022–2023 charging records, reports **215,008 public DC sessions**, averaging **34.24 minutes** and **23.6 kWh**; median duration was **29 minutes**, with the 75th percentile at **44 minutes**. Its sample, fleet and infrastructure are not a prescription for German motorway HPC booking. Nevertheless, it challenges presenting two hours as an evidence-based default. [Original research](https://www.mdpi.com/2313-0105/12/7/243).

Manufacturer figures illustrate the dependence on charger and vehicle. Hyundai gives its 84 kWh IONIQ 5 a **10–80% time of 18 minutes at a suitable 350 kW DC station**, versus **76 minutes at 50 kW**, under its specified conditions. A charger’s headline power is not a constant delivered rate. [Hyundai specifications](https://www.hyundai.com/eu/en/models/ioniq5/performance.html).

Correct the units:

- **kW:** instantaneous charging power.
- **kWh:** energy delivered.
- **€/kWh:** energy price.
- “300KwH” and “charged kW/h” should not remain.

Illustration: adding 42 kWh takes an idealised 21 minutes at an average 120 kW, or 50.4 minutes at 50 kW. Real sessions add tapering, temperature, power sharing, connection and departure time.

**Product recommendation:** Offer driver-selected duration, initially testing **45/60/90 minutes**, with a 120-minute option where appropriate. Keep duration separate from scheduled arrival and departure deadline. This is a proposed pilot configuration, not a research-derived universal optimum.

Likewise, separate:

- Calendar granularity, such as 15-minute selectable starts.
- Pre-arrival protection.
- Arrival grace.
- Physical turnover allowance.
- Overstay fee grace.

With 30 productive minutes and an enforced 15-minute empty gap, theoretical productive time is only `30/(30+15) = 66.7%`, even before no-shows. With 45 minutes charging plus 15 minutes combined overhead, it is 75%.

A 60-day calendar should be a later, qualified product. For the journey prototype, recommend a **same-day/eight-hour horizon** and one reservable bay at a multi-bay site. Preserve the 60-day idea for controlled hotel/event inventory.

Free walk-ins are useful only if their expected session plus exit allowance fits before the next protected interval. Display a clear departure deadline and obtain acceptance. A reminder cannot physically remove an overstaying vehicle.

## Operational proposal covering the core missions

The challenge establishes conceptual reserve, release, status and plate-event capabilities. It does **not** establish endpoint names, acknowledgement semantics, event reliability, occupancy sensing, safe actuator behaviour or charger telemetry. Everything below is a proposed application contract pending hardware/API verification.

Maintain separate state dimensions:

| Dimension | Example states |
|---|---|
| Booking | Requested, confirmed, cancelled, expired/no-show, fulfilled |
| Bay/hardware | Clear, protected, opening, occupied, releasing, fault/unknown |
| Charger | Available, connected, charging, finished, fault/unknown |
| Identity | Awaiting vehicle, matched, mismatch, recognition failed, manually verified |

A booking can remain confirmed while a new hardware fault is detected. A car can be present while no electricity flows. Avoid compressing these into one green/red value.

**Reservation/concurrency:** Validate inventory in one authoritative backend transaction. Two users requesting overlapping protected intervals must not both succeed. Use idempotency keys and booking versions so retries do not duplicate reservations or reverse newer decisions. Store UTC timestamps and render local time.

**Physical commands:** Distinguish request received, command accepted and physical state confirmed. A timeout means **unknown outcome**, not automatic success or failure. Reconcile against a fresh state before retrying an actuator command or selling the bay again.

**Arrival:** Correct plate plus an eligible booking permits a server-authorised opening request. Early arrival is offered only if compatible with existing commitments. Late arrival consumes the original period rather than extending the next booking.

**No-show:** At the arrival deadline, classify unused bookings separately from failed access. Release inventory only after the bay’s actual condition is known. Do not bill a driver as absent when plate recognition or the gate failed.

**Failed/wrong plate:** Offer a booking-scoped fallback after authentication, proximity/onsite evidence and a clear physical state. Log the reason. Biometrics/passcode can authenticate the app user; they do not prove the correct vehicle is present. Do not build biometric collection or plate OCR solely to satisfy that new plan phrase.

**Blocked bay:** Mark service impaired as soon as credible occupancy evidence arrives. Seek another verified compatible bay; otherwise offer cancellation/refund and navigation alternatives. A minute polling interval is not an availability guarantee. A ten-minute-before-arrival check helps but misses later incidents.

**Overstay:** Warn before departure, at deadline and after grace. Never close protection onto an occupied bay or strand the vehicle. Trigger recovery for the next driver immediately; fee accrual is not a recovery mechanism.

**Outage:** Stop new promises when essential state is stale. Show pending/unknown status honestly. Safe local release and emergency procedures depend on Ecurious hardware documentation, not a software assumption.

Recommended configurable inputs include arrival grace, protection lead, turnover time, telemetry age limit, recognition-confidence policy, retry limit, cancellation thresholds and compensation budget. Select them from measured exit times, API latency, arrival error and fault rates after the demo.

## Interoperability and data

GoingElectric provides directory queries, connector/power filters, locations and reported faults. Its documentation does not establish reservation control or trustworthy real-time physical-bay occupancy. A listed site may represent multiple connectors without a one-to-one BayWatch hardware mapping. [API documentation](https://www.goingelectric.de/stromtankstellen/api/docs/).

Its published terms require end-device retrieval, a maximum 24-hour device cache, a retrieval timestamp if stored longer than an hour, free no-registration access to the data, source attribution and a visible clickable directory link. They also require distinguishing information from different sources. **Do not silently implement a conventional backend cache in conflict with those terms.** Clarify any challenge-specific permission through the organisers’ existing arrangements. [GoingElectric terms](https://www.goingelectric.de/stromtankstellen/api/terms/).

Recommended architecture:

- Public discovery: GoingElectric, with required attribution/access.
- Booking and bay control: BayWatch backend → Ecurious server.
- Charging status/payment: CPO integration only where actually available.
- Explicit mapping: directory location → CPO location/EVSE → physical bay → Ecurious hardware ID.

For future partners:

- **OCPP** connects charging stations to central management systems. The Open Charge Alliance currently lists 1.6, 2.0.1 and 2.1; protocol/version support must be verified per installation.
- **OCPI** connects CPO/eMSP systems. Core `RESERVE_NOW` is an immediate token-based reservation with expiry and asynchronous results.
- **OCPI 2.3.0 optional Bookings** supports calendars and scheduled booking objects; its access methods include licence plates.

[OCPP overview](https://openchargealliance.org/protocols/ocpp-protocols/), [OCPI Commands](https://github.com/ocpi/ocpi/blob/2.3.0/release/core/mod_commands.asciidoc), [OCPI Bookings](https://github.com/ocpi/ocpi/blob/2.3.0/release/bookings/mod_bookings.asciidoc).

For the hackathon, document a small partner booking contract and its mapping to OCPI Bookings. Do not implement an entire roaming platform. Standards support neither guarantees a clear parking space nor confirms that Ecurious implements those standards.

Data-flow dependencies for the separate GDPR work are plate/booking linkage, camera processing location, raw-image retention, operator access, manual override audit, payment identifiers and third-party navigation. Charging telemetry may introduce additional account/session linkage.

## Business case and utilisation

Track five separate outcomes:

1. Physical occupancy: occupied bay-minutes.
2. Productive charging utilisation: actual charging-minutes.
3. Throughput: completed sessions and delivered kWh.
4. Operational availability: serviceable bay/connector time.
5. Driver certainty: successful arrivals within the promised window.

Occupancy alone can rise because cars overstay.

**Reservation-induced idle-loss example:** Ten bookings each create ten additional empty minutes at a fully demanded site. That removes 100 minutes. At an assumed 30-minute productive session, capacity lost is `100/30 = 3.33` sessions. At hypothetical 30 kWh/session and €0.10/kWh contribution, foregone CPO contribution is **€10/day**. Ten €3 reservation fees split 50:50 give the operator €15/day before costs: a narrow €5 gain. At €0.20/kWh contribution the same lost capacity costs €20/day, making the operator worse off. These are scenarios, not market measurements.

**Illustrative per-bay platform economics**, excluding VAT settlement, corporate overhead, financing and tax:

| Input | Explicit assumption |
|---|---:|
| Reservation collected | €3.00 |
| Operator payout | €1.50 |
| Card processing | €0.295 |
| Support allowance | €0.20 |
| Expected refunds | 2% × €3 = €0.06 |
| Expected compensation | 2% × €5 = €0.10 |
| Variable messaging/API | €0.02 |
| Remaining contribution | **€0.825/booking** |

The processing example uses Stripe’s published **1.5% + €0.25** standard EEA-card price: `3 × 0.015 + 0.25`. Other cards, Connect, disputes and additional services can cost more. [Stripe Germany](https://stripe.com/de/pricing).

Assume hardware €50 **solely as the plan’s unverified input**, installation €150, amortised over 36 months: €5.56/month. Add assumed connectivity €3, maintenance €4, hosting €2 and other provision €2: **€16.56 fixed/month**.

| Scenario | Calculation | Monthly contribution after assumed fixed costs |
|---|---|---:|
| Low demand: 0.5 bookings/day | 15 × €0.825 − €16.56 | **−€4.19** |
| Base: 2/day | 60 × €0.825 − €16.56 | **€32.94** |
| Fault-heavy: 4/day | 120 × −€0.015 − €16.56 | **−€18.36** |

The fault-heavy case assumes 10% refunds, 10% €5 credits and €0.40 support per booking; remaining contribution becomes −€0.015. More bookings amplify losses.

Base break-even is `16.56/0.825 = 20.1 bookings/month`, approximately **0.67/day**, before omitted costs and taxes. If installed capital costs €1,000 instead, the same amortisation plus other fixed assumptions becomes €38.78/month: **47 bookings/month** to break even.

A hypothetical 3% commission on `40 kWh × €0.60 = €24` yields €0.72. It exists only if the CPO contract grants it, the session is attributable and settlement is available. Do not include the plan’s 1–5% in the base case.

“Reservation money proves demand” should become: **paid completed bookings test willingness to pay; repeat use and incremental CPO contribution test sustainability.** No-show penalties should discourage waste, not underpin profitability.

## Worked extension and four-person demo

**Hotel extension:** A hotel has four AC bays. One guest books 18:00–22:00 with a registered plate; other bays remain walk-in. At 17:50 the bay is protected, arrival opens it, and departure is checked at 22:00. Late arrival retains the original end time; an approved extension requires free inventory. If the bay fails, reception offers another verified bay or refunds the reservation.

The hotel’s longer, predictable stay supports different durations and advance horizons from motorway DC. No hotel integration or guaranteed battery target should be claimed.

Allocate the existing four people to:

- Existing app flow and clear booking/status copy.
- Ecurious integration and hardware evidence.
- Scenario execution, concurrency/failure checks and documentation.
- Business/utilisation model, interoperability mapping and presentation.

Demonstrate all seven missions with one coherent journey: real reservation, actual plate event and hardware response; accelerated no-show; blocked-bay recovery; partner contract diagram; hotel worked example; utilisation comparison; auditable economics.

Record each item as **implemented/live**, **simulated**, **modelled** or **proposed**. Charging energy, telemetry and payments must retain those labels unless actually integrated. Preserve request/response evidence with sensitive values removed.

## Proposed Notion changes — do not apply yet

| Current text or earlier snapshot | Proposed replacement |
|---|---|
| “50 euros for reservation hardware” | “Hardware commercial terms unverified; obtain unit, installation, recurring and maintenance costs.” |
| “Money from reservation also proven demand” | “Pilot hypothesis: measure paid conversion, successful arrival, repeat use and incremental operator contribution.” |
| “charged kW/h”; “300KwH” | Correct to €/kWh and kW; explain vehicle/site constraints. |
| “15 minutes between bookings…” | Separate selectable calendar steps from protection, grace and turnover. |
| “2h fast chargers”; 1h at 1.5× | Driver-selected duration; test shorter journey defaults. Remove unexplained price multiplier. |
| “60 days” | Same-day pilot; longer horizon reserved for qualified use cases. |
| Free walk-in unlocking | Deadline-aware walk-ins only when they fit before the next commitment. |
| Manual app unlocking | Authenticated, booking-scoped override with physical safety conditions and audit. |
| Charger displays charging state in app | State integration dependency; label simulated telemetry explicitly. |
| Earlier “0,30ct/min”, cancellation percentages, €5 credit | Resolve units and fee basis; keep configurable and unapproved. Define recovery/refunds before compensation amounts. |

## Next decisions, in priority order

1. **Promise:** protected bay with charger status disclosed; avoid energy guarantees.
2. **Hardware contract:** confirm acknowledgements, occupancy sensing, plate events, safe release and outages.
3. **Booking timing:** choose arrival, deadline and selectable duration; test 45/60/90-minute DC options.
4. **Inventory/horizon:** start with limited reserved capacity and same-day booking.
5. **Grace/buffers:** choose separately; account for their combined capacity cost.
6. **Failure remedy:** recommend full reservation refund when BayWatch cannot provide access; additional credit requires a funded policy.
7. **Fee model:** test one understandable reservation fee before dynamic pricing or complex cancellation tiers.
8. **Data architecture:** resolve GoingElectric permissions and physical/CPO identifiers before assuming a proxy or real-time status.
9. **Commercial split:** obtain actual hardware economics and CPO commission terms.
10. **Demo boundary:** agree exactly what will be live, simulated, modelled and proposed.

The 20 linked primary sources above were accessed on **24 October 2026**. Most provider pages were undated; the explicit dates verified were Mercedes’ **21 May 2025** support update and the research paper’s **6 July 2026** publication. Protocol release branches and operator tariffs remain moving sources. Agent Reach’s documented Jina route worked; its optional CLI update check could not run because `agent-reach` was unavailable in this shell.
