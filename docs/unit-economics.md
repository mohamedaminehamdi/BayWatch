# Unit economics: who gets what from a booking

Every booking's money goes to four parties:

- **The driver** pays the receipt.
- **Stripe** takes its card fee.
- **The charge point operator (CPO)** and **BayWatch** split what's left.

**Ecurious** earns 1–5% of the charged kWh revenue, which the CPO pays. That money never passes through our payments.

The split is computed in code by `split()` in [revenue.ts](../web/lib/revenue.ts), with tests in `revenue.test.ts`. Every number below comes from it.

**Prices** are the team's price policy of 2026-10-24: fast 1 h €3, fast 2 h €5 (€3 when quiet, up to €6 at peak), and slow 4 h €4.

**Status:** the policy isn't in the engine yet. See [conflicts to resolve](#conflicts-to-resolve).

## Assumptions

| What | Value | Status |
|---|---|---|
| Stripe fee | 1.5% + €0.25 per successful card payment (standard EEA card) | **Verified** in Stripe test mode on 2026-10-24 with a German test card: €5 → €0.33, €0.50 → €0.26, €3 → €0.30, €4 → €0.31, €6 → €0.34. UK cards cost 2.5%, other cards 3.25%. |
| Refunds | Stripe keeps its fee | **Verified:** a €5 charge refunded in full still cost €0.33 |
| Released card hold | costs nothing | **Verified:** an uncaptured hold that's cancelled has no fee |
| CPO share of reservation money | 70% (BayWatch 30%) | Assumption, `CPO_RESERVATION_SHARE` |
| CPO share of overstay | 50% | Team plan, `CPO_OVERSTAY_SHARE` |
| Stripe's fee | comes off both shares in proportion | Assumption |
| Credits (the €5 for a blocked bay) | funded by BayWatch; the CPO is paid as if the driver had paid | **Open:** the CPO could fund it instead |
| Hardware + installation | €200 per bay, paid by BayWatch | Team figure |
| Smallest card charge | €0.50 (Stripe's EUR minimum); anything smaller is waived | As in [payments.md](payments.md) |

## Per booking

Completed bookings and no-shows are the same money, because a no-show keeps 100% of the fee.

| Booking | Driver pays | Stripe | CPO | BayWatch |
|---|---|---|---|---|
| Fast 2 h, quiet | €3.00 | €0.30 | €1.89 | **€0.81** |
| Fast 2 h, normal | €5.00 | €0.33 | €3.27 | **€1.40** |
| Fast 2 h, busy *(proposed)* | €5.50 | €0.33 | €3.62 | **€1.55** |
| Fast 2 h, peak | €6.00 | €0.34 | €3.96 | **€1.70** |
| Fast 1 h | €3.00 | €0.30 | €1.89 | **€0.81** |
| Slow 4 h | €4.00 | €0.31 | €2.58 | **€1.11** |

**Cancelling**, on a €5 booking. The amounts are shares of the fee kept, under the team's tiers.

| When | Kept | Driver pays | Stripe | CPO | BayWatch |
|---|---|---|---|---|---|
| Within 2 min of booking, or ≥ 24 h ahead | 0% | €0 | €0 (the hold is released) | €0 | €0 |
| Within 24 h | 10% | €0.50 | €0.26 | €0.17 | €0.07 |
| Within 1 h | 50% | €2.50 | €0.29 | €1.55 | €0.66 |
| Within 5 min | 60% | €3.00 | €0.30 | €1.89 | €0.81 |
| No-show | 100% | €5.00 | €0.33 | €3.27 | €1.40 |

- **The 10% tier is waived on the €3 and €4 bookings.** That's €0.30 or €0.40, under the card minimum. On a €6 booking it's €0.60, which leaves €0.10 for BayWatch after Stripe.
- **Cancelling always costs less than not turning up,** at every tier.

**Overstay** is €0.30/min after 5 free minutes, so 10 minutes over is €3.

| How it's charged | Stripe | CPO | BayWatch |
|---|---|---|---|
| A separate card payment | €0.30 | €1.35 | €1.35 |
| Together with the €5 fee, in one payment | €0.37 for both | €4.77 for both | €2.86 for both, **€0.11 more** than two payments |

**A blocked bay** releases the hold (€0 to everyone) and gives the driver €5 credit. When that credit pays for their next €5 booking, BayWatch pays the CPO's €3.50 and earns nothing. So one blocked bay costs BayWatch about 3.5 normal bookings' margin.

## Hold, or charge and refund?

The Stripe design already built is in [payments.md](payments.md). It places a **card hold** at booking and captures only what the receipt says at the end. The alternative is to charge the fee up front and refund it on a free cancel, but every one of those refunds would lose €0.33.

| Free cancel of a €5 booking | Stripe | BayWatch |
|---|---|---|
| Hold, then release (built) | €0 | €0 |
| Charge, then refund in full | €0.33 kept | **−€0.33** |

So the hold design stays. For advance bookings more than 7 days ahead, a hold would expire, so the card is saved first (SetupIntent, off-session) and held or charged later. A test-mode run did exactly that: it saved the card, then made an off-session charge for €3 of overstay, which succeeded with no extra authentication.

## Paying back the €200 bay

From BayWatch's share alone:

| Mix | Per booking | Bookings to €200 |
|---|---|---|
| Quiet, or fast 1 h | €0.81 | 247 |
| Slow 4 h | €1.11 | 181 |
| Normal fast 2 h | €1.40 | **143** |
| Peak | €1.70 | 118 |

**Days to payback** at normal demand. Bay Guard (€19 per bay per month, paid by the CPO) brings in €18.46 after Stripe.

| Bookings a day | Bookings only | With Bay Guard |
|---|---|---|
| 1 | 143 days | 100 days |
| 2 | **72 days, inside the 90-day pilot** | 59 days |
| 4 | 36 days | 33 days |

If the CPO buys the device instead, its €3.27 per normal booking pays it back in 62 bookings: 31 days at two a day.

**Ecurious's share,** for illustration: a 35 kWh DC session at €0.59/kWh is €20.65 of charging. At 1–5%, that's €0.21–1.03 per session, paid by the CPO.

## Dynamic pricing in the 90-day pilot

Demand pricing applies to the fast 2 h booking only. Fast 1 h (€3) and slow 4 h (€4) are flat.

| Demand tier | Fast 2 h |
|---|---|
| Quiet | €3 |
| Normal | €5 |
| Busy | €5.50 *(proposed: the policy names only low, normal and "up to €6")* |
| Peak | €6, the cap |

- **The price is fixed once the booking is confirmed.**
- **During the pilot**, a forecast sets the tier ahead of time. It uses past bookings, the weekday and time, holidays, and local events.
- **In the prototype**, the tier comes from the site's occupancy, or from the demo's "Site demand" control. Nothing is forecast yet.

## Not built

- **Payouts.** The split is recorded, but no money is paid out. With Stripe Connect, each settled booking would create a transfer to the CPO's connected account, using `transfer_group` = the booking id, right after the capture in `settleBooking` ([payments.ts](../web/lib/payments.ts)).
- **A webhook.** It isn't needed while cards are the only method. Add one once SEPA or other asynchronous methods are turned on.
- **Strong Customer Authentication (EU).** The hold at booking is confirmed by the driver, in the Payment Element. Off-session charges (overstay, advance holds) are merchant-initiated under the saved card's mandate, but a bank can still ask for authentication. The flow for that is in [payments.md](payments.md#when-the-card-is-held-once-cancelling-can-cost-money).

## Conflicts to resolve

The team's price policy disagrees with the booking v2 spec that the engine is being rebuilt against:

| Rule | Price policy (this doc) | v2 spec / engine |
|---|---|---|
| Fees | Fast 1 h €3 · fast 2 h €5 (€3–6) · slow 4 h €4 | €2.50 × class (slow 0.5×, ultra 1.5×) × demand, capped at €4 |
| Cap | €6 | €4 |
| Cancel tiers | 10% < 24 h · 50% < 1 h · 60% < 5 min | 10% < 24 h · 50% < 30 min · 80% < 5 min |
| Arrival grace | 5 min (the team's earlier answer) | 15 min |
| "Running late" +5 min for €0.50 | kept | removed |
| Overstay, credits, 100% no-show, no reliability rule | the same | the same |
