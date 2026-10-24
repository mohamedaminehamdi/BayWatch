# BayWatch: GDPR/DSGVO privacy research report (planning stage)

> Original research draft from Claude Opus 5.5, 24 October 2026. Completed before the repository was cloned; implementation assumptions are not a code audit. Specific legal-basis, DPIA and DPO conclusions require case-specific review. The cloned repository already contains Ecurious REST and event-stream adapter code behind explicit live-mode flags; hardware operation has not been verified.


**Prepared:** 2026-10-24, about 13:32 CEST, by the Claude Opus 5.5 privacy research agent on the Claude2 provider. The retry worked. I changed no provider, account, auth or model setting.

**Read-only:** I edited nothing in Notion, the app/repo, settings or external accounts, and contacted nobody. The only files I wrote were temporary retrieval copies under `/tmp/bw`.

**What this is:** a planning-stage review of the plan text and official sources. No code, contracts, Ecurious docs, hardware, hosting or vendor setup has been audited. It is not a compliance certification or legal advice.

---

## 0. How fresh the plan text is

| Fetch (CEST) | Method | Result |
|---|---|---|
| 13:22:53 | Jina reader `www.notion.so/BayWatch-…` | **Truncated** (2.1 KB). It stopped at "card details (eg. over stipe)". |
| 13:23–13:24 | Notion public `loadCachedPageChunkV2` (read-only POST) | Full tree, page v201, last edited 13:22:05. |
| 13:30:35 | Same | v203, new line "deduction of reservation fee at moment of reservation". |
| **13:31:25** | Same (**final recheck**) | **v216, last edited 13:29 CEST.** New lines: profile = "adress, full name, email, phone number, payment profile"; app = "licenseplate (if added more, one preffered), **gps data, biometrics of user**"; "reimbursement if cancelled properly"; "future … SEPA or card mandate". |

**Correction to Sol's 13:20 note:** the overstay, blocked-bay, no-show (100% fee; 10/50/80% tiered cancellation), rerouting with €5 credit, and "give unused spots to business partners e.g. uber" sections **were still on the page** in every block-level fetch. The short version was a **Jina extraction truncation, not a deletion**. The Notion "Published Time" header is not the last-edit time; I used the block `last_edited_time` instead.

The page was changing every few minutes during this review. Anything below may already be out of date.

**Challenge page** (fetched 13:23; blocks last edited 09:59 UTC):
- "Treat user, location and license plate data responsibly and in line with GDPR."
- The jury expects responsible handling of plate data from every team, and "clear violations can lead to point deductions."
- One guiding question asks about "data minimisation, retention, consent."
- Ecurious API documentation is "provided on site". I could find **no public Ecurious documentation**, so every hardware and server capability below is an assumption.

**What the live plan now describes:**
- A physical **gate** at the bay that unlocks when the plate is recognised, plus a manual unlock in the app.
- The gate checks the bay is empty and then closes.
- Occupancy checked every minute; walk-in use when the bay is free; red/green LED.
- The data fields listed above, plus Stripe/PayPal/Apple Pay.
- Future: in-app charging, a single payment provider, and Google/Apple Maps integration.

---

## 1. Priority findings

**F1. "Biometrics of user" is the biggest new risk, and it is avoidable.**
- If BayWatch collects, stores or matches face or fingerprint templates on its servers, that is special-category data (Art 4(14), Art 9). It would need an Art 9(2) exception, typically explicit consent with a real alternative.
- Biometric systems are item 1 on the German DSK list of processing that always needs a DPIA.
- OS-level local authentication (Face ID, Touch ID, Android BiometricPrompt) only returns pass/fail to the app.
- **Proposal:** reword the plan to "device unlock via OS authentication (biometric or PIN); BayWatch never receives biometric data." This is a product choice that removes Art 9 from scope. It is not a legal requirement to use OS authentication.

**F2. Plate events tied to time and place are personal data.**
- A plate plus a timestamp at a known bay, linked to an account, is personal data under Art 4(1) ("identifier", "location data").
- The CJEU's VIN ruling (C-319/22 *Scania*, paras 46–49) holds that a vehicle identifier is personal data for anyone who can reasonably link it to a person. Plates are analogous, but the ruling is about VINs, so this is reasoning by analogy.
- Private operators can obtain holder data via §39(1) StVG (noted by LDI NRW).
- Hashing doesn't take plate events outside the GDPR. Under C-413/23 P *SRB* (paras 73, 76), a controller that still holds the re-identifying data is still processing personal data. Plates also have a small keyspace, so an unsalted hash can be reversed by trying every plate.
- A plate is **not** biometric data. It identifies an object, not a person's physical traits. Faces caught in a frame only become biometric data through "specific technical processing" for unique identification (EDPB Guidelines 3/2019, §5.1).

**F3. Other drivers and bystanders are the hardest legal issue, and booking-user consent doesn't solve it.**
- The camera also sees blocking cars, walk-in users and passers-by.
- A booking user's consent can't authorise processing someone else's plate. For CCTV-style monitoring, consent is only exceptionally workable, and walking or driving into a signposted area is not consent (EDPB 3/2019 paras 43–46).
- The realistic legal basis is legitimate interest (Art 6(1)(f)) with strict minimisation. This is how LDI NRW and the Saxon DPA treat plate capture at parking sites.
- **Proposal:** match only against the expected plate(s), on the device if the hardware can do it. Output "matched / other vehicle / empty". Do not store non-matching plates unless the team deliberately decides to enforce against blockers. That would be a separate, heavier processing step needing its own assessment.

**F4. Contract necessity for plate check-in depends on offering alternatives.**
- Under C-252/21 *Meta* paras 98–99, contract necessity (Art 6(1)(b)) needs processing that is "objectively indispensable", with "no workable, less intrusive alternatives".
- The plan already has a manual app unlock, so LPR is clearly not the only way to fulfil the booking.
- **Proposal:** make plate check-in the user's chosen access method and keep an equal alternative (an app or bay code). Then plate matching is the service the user picked, under Art 6(1)(b), with Art 6(1)(f) as a fallback argument. Don't make consent the core basis for the booking user. Withdrawing it would break the booking, and consent tied to the service isn't freely given.
- OCPI 2.3.0 Bookings already offers `TOKEN` and `ACCESS_CODE` next to `LICENSE_PLATE`, which supports the alternative-access design.

**F5. Drop the "72 hours = legal" assumption, and match each retention period to its purpose.**
- No universal statutory 72-hour retention period exists. EDPB 3/2019 para 121 and the DSK guidance on video surveillance by private bodies treat a few days, or 72 hours, as normally enough for **property-protection video**. Going longer needs more justification.
- That benchmark does not fit plate events kept for booking or billing purposes.
- The 72 hours in Art 33 is the breach-notification deadline, not a retention rule.
- Tax rules (§147(3) AO: 8 years for accounting vouchers, 10 for books) apply to billing records. Those records don't need plates or images.

**F6. Several profile fields look unnecessary for the stated purposes.**
- **Address:** German simplified invoices up to €250 (§33 UStDV) don't need the recipient's address. Any billing address a payment provider needs can be collected in the provider's own hosted form.
- **Full name and phone:** justify each one or make it optional.
- **GPS:** foreground location only, when the user asks for "near me" or "on the way". Not background tracking.
- **Several plates per account:** fine, but match only the plate(s) assigned to the active booking.
- **Card details:** use the payment provider's hosted fields or tokens so raw card numbers never reach BayWatch servers. The actual architecture is unknown.

**F7. Roles are undetermined, and the challenge setup points to more than one controller.**
- Ecurious runs the camera, LPR, server and plate events. BayWatch decides why bookings, fees and accounts exist. The charge point operator (CPO) or site owner controls the bay.
- Depending on how purposes and means are actually split, Ecurious could be BayWatch's processor, an independent controller, or a joint controller.
- The EDPB says this must be assessed on the facts, not on contract labels. "Converging decisions" can create joint controllership, and a party can be a controller without ever seeing the data (Guidelines 07/2020 paras 40, 52, 55–56).

**F8. Other drivers' details should never reach BayWatch users.**
- Blocked-bay and rerouting messages must not reveal another driver's plate or image.
- Answering an access request must not hand over footage that identifies other people. Masking may be needed (EDPB 3/2019 paras 92–95; Art 15(4)).

---

## 2. Data map

Status: **K** = stated in the plan or challenge; **C** = conditional or unconfirmed.

| # | Data | Source → destination | Purpose | Status |
|---|---|---|---|---|
| 1 | Account: email, name, phone, address, "payment profile" | User → BayWatch backend (hosting unknown) | Account, booking contract, contact | K (field list as of 13:28) |
| 2 | Plate(s); one preferred | User → BayWatch → Ecurious server (expected plate for the booking) | Plate check-in | K |
| 3 | Camera frame / image | Bay camera → Ecurious hardware/server; stored? where? how long? | Plate recognition, occupancy | K camera; C storage |
| 4 | Plate event (plate text, confidence, time, bay ID, maybe crop) | Ecurious → BayWatch (via API, webhook or polling) | Check-in, gate unlock, blocked-bay detection, fees | K exists ("plate events"); C format/content |
| 5 | Occupancy status every minute | Hardware → Ecurious → BayWatch | Blocked bay, overstay, gate close | K |
| 6 | Non-user plates (blockers, walk-ins) and bystanders | Camera → Ecurious → maybe BayWatch | Blocked-bay detection, walk-in timing | K captured; C kept |
| 7 | Booking: times, duration, bay, fees, cancellations, credits | BayWatch → payment provider; BayWatch → CPO | Contract, billing, revenue share | K |
| 8 | Payment instruments | User → Stripe / PayPal / Apple Pay (hosted) → token back to BayWatch | Payment | K intent; C architecture |
| 9 | Device GPS | Phone → BayWatch and/or GoingElectric query parameters; maybe Maps SDKs | Nearby / on-route search; maybe ETA or no-show detection | K "gps data"; C use |
| 10 | GoingElectric charger queries | Phone → GoingElectric directly (their terms require retrieval from the end device, cached at most 24 hours) | Map | K; GoingElectric receives IP address and map area |
| 11 | Push tokens and messages | App → APNs/FCM → device | Reminders, overstay, blocked bay | K pushes; C provider |
| 12 | Charging state | Charger → CPO backend → BayWatch | In-app status | K intent; C interface |
| 13 | Device biometrics | Should stay on the device (OS) | Authorise booking or unlock | K "biometrics"; C implementation (F1) |
| 14 | Interop / third parties (OCPI eMSPs, maps, "Uber" partners) | BayWatch ↔ eMSP/CPO (OCPI booking can carry the plate) | Interop, new use cases | C future |
| 15 | Analytics / KPIs for CPOs | BayWatch → CPO dashboards | Utilisation, business case | C (see §4) |

**Unknowns that change everything:**
- Which legal entities exist: BayWatch has none yet; who Ecurious contracts with; who the CPO or site owner is.
- Where each piece of data is stored.
- Whether the hardware keeps full frames, and for how long.
- Whether plate recognition runs on the device or in the Ecurious cloud.
- Where the Ecurious server is hosted.

---

## 3. Controller, processor and joint-controller scenarios

| Scenario | Fits if… | Consequences |
|---|---|---|
| **A. BayWatch controller, Ecurious processor (Art 28)** | Ecurious processes plates and frames only on BayWatch's instructions; BayWatch sets retention and recipients (the "essential means"); Ecurious doesn't reuse data, e.g. for training | Art 28 contract, list of subprocessors, instructions on deletion. BayWatch carries the transparency and legal-basis burden for camera capture. |
| **B. Ecurious or the CPO as an independent controller of the camera; BayWatch controller of bookings** | Ecurious or the CPO runs the camera for its own purposes (bay protection, product improvement) and sets retention | Each needs its own legal basis and notice. The interface is a controller-to-controller transfer. Signs must name the right controller. |
| **C. Joint controllers (Art 26)** | BayWatch and Ecurious (and/or the CPO) together decide that plates are captured for check-in and enforcement and how; the processing can't happen without both | An Art 26 arrangement, with its essence available to drivers; one contact point. EDPB 07/2020 paras 52–56. |
| **D. Payment, push, maps vendors** | Stripe and PayPal often act as independent controllers for their own fraud and regulatory processing; push and hosting are usually processors | Check each vendor's terms. Don't assume from labels. |

**Documents and questions needed:**
- Ecurious API docs and data sheet: frame storage, on-device vs cloud recognition, what the event payload contains, retention settings, hosting location.
- Any Ecurious terms or data processing agreement, and whether Ecurious reuses data or trains on it.
- Who owns and runs the hackathon test bay.
- Whether the CPO receives plates.
- What legal form BayWatch would take for a pilot.

---

## 4. Legal basis by purpose

| Purpose | Basis to test | Necessity and proportionality notes |
|---|---|---|
| Booking fulfilment and matching the booking user's plate | **Art 6(1)(b)**, if LPR is the access method the user chose and an equal alternative exists; otherwise Art 6(1)(f) | *Meta* paras 98–99. Match only plates on the active booking, only during the booking window plus grace period. |
| Gate unlock through the app (fallback) | Art 6(1)(b) | Prefer a code or QR shown at the bay over GPS proximity checks. |
| Capturing other drivers' vehicles (blocked bay, walk-ins) | **Art 6(1)(f)** only | Three-step test (*TK* C-708/18 paras 40, 46–47; *Meta* paras 106–109). Need: knowing whether the reserved bay is free. Least intrusive: "occupied by another vehicle", with the plate discarded. Consent can't work here (F3). |
| Enforcing fees against blockers (non-users) | Art 6(1)(f) at best; also needs a **civil-law** basis for any charge (posted site terms, §39 StVG holder queries) | A separate, high-impact purpose. LDI NRW and Saxony accept parking-rule enforcement under 6(1)(f) with signs placed before entry. **Recommend excluding it from the hackathon and initial pilot.** Don't build reporting to authorities. Some traffic-offence data falls under Art 10 (C-439/19, para 93). |
| No-show, overstay and cancellation fees for users | Art 6(1)(b) for calculating them; 6(1)(f) or (b) for dispute evidence | If fees are charged purely automatically from LPR or occupancy events, Art 22 may apply. Provide notice, a way to contest, and human review (Art 22(3)) either way. |
| Fraud prevention | Art 6(1)(f) | Avoid opaque scoring. Fraud-prevention systems that combine data at scale appear on the DSK DPIA must-list (item 5). |
| Foreground location for search | Art 6(1)(b)/(f); reading device data under **§25(2) No. 2 TDDDG** (strictly necessary for a service the user explicitly asked for) plus OS permission | Not background tracking. |
| ETA / background location for no-show prediction | Opt-in only (consent under §25(1) TDDDG and the GDPR), off by default | Not needed for the basic booking. |
| Product analytics and CPO KPIs | Aggregated or de-identified KPIs under Art 6(1)(f). SDKs that read the device need §25(1) TDDDG consent unless strictly necessary | KPIs such as utilisation, no-show rate and dwell time don't need plates. |
| Marketing (signup rewards, partner offers) | Consent | Separate from service pushes. Not checked in depth here. |

**German law and public vs private operators:**
- For private operators, video surveillance is assessed directly under Art 6(1)(f), **not under §4 BDSG** (BVerwG 6 C 2.18, para 47, as stated in footnote 8 of the DSK guidance).
- §4 BDSG and state laws matter if the bay is operated by a **public body**, for example a municipality acting under public law.
- The DSK's 2019 resolution against mass automated plate recording, and police plate-scanning case law, concern **state** surveillance. They shouldn't be applied directly to a small private reservation bay. They do show how strongly authorities react to building up plate databases.

---

## 5. Minimisation, retention, security, transfers

**Privacy by design** (Art 25; whether each step is possible depends on the hardware):
1. Recognise plates on the device if Ecurious supports it. Send only `{bay, booking_id or match status, confidence, time}` to BayWatch.
2. Mask or crop the camera view to the bay's plate zone. No pavement, no faces, **no audio**, no continuous recording. Per LDI NRW, what counts is resolution, operating hours and software filters, not just where the camera points.
3. Compare against expected plates only. Discard non-matching plate text right away, or keep a keyed hash only for the duration of an open blocked-bay incident.
4. No raw images in BayWatch storage by default. Store images only for an open, specific dispute, in a separate store with restricted access.
5. No plates or images in app logs, crash reports, analytics or push contents ("Your bay is ready", not "ABC-123 detected").
6. No training or product-improvement reuse by default. Get this in writing from Ecurious.
7. Field minimisation: drop the address and make phone optional unless a purpose is documented.

**Proposed retention** (placeholders for the team to decide; derived from purposes, not set by law):

| Data | Trigger | Proposal |
|---|---|---|
| Raw frames (hardware/Ecurious) | Event extracted | Delete immediately or within minutes or hours. Hardware-dependent; ask Ecurious. |
| Non-matching plate text | Match decision | Don't keep, or delete when the incident closes. |
| Booking user's plate events | Booking closed | Booking end plus a dispute window (e.g. 14–30 days; decision needed), then delete or reduce to "checked in yes/no". |
| Dispute evidence (if any) | Dispute opened | Until resolved plus any statutory limitation period actually relied on. Document it. |
| Billing records (no plate or image) | Calendar year end | §147 AO periods (8 years for accounting vouchers). |
| Account plate | User deletes vehicle or account | Delete, except where needed for billing or disputes. |
| Backups | Rolling | Documented expiry. Deleted items must not be restored into live systems. |

**Security** (Art 32):
- Keep Ecurious credentials **server-side only**: not in the app bundle, not in the repo.
- TLS everywhere.
- Authenticate plate and unlock events: signed webhooks or mutual auth, timestamp and nonce to stop replay. An app unlock must be bound to the booking holder and the time window.
- Rate limits on unlock and lookup endpoints.
- Least privilege: support staff see match status, not plates or images. Audit logs for every plate or image access.
- Least-privilege API scopes for CPO and partner access.
- A breach procedure (Art 33: report to the DPA within 72 hours where required; Art 34: inform affected people where required).

**Payments:**
- Use Stripe Checkout or Payment Element, PayPal, or Apple Pay so card numbers never touch BayWatch.
- Store only provider tokens and customer IDs.
- The planned future SEPA or card mandate should also run through the payment provider's mandate flows.
- Whether this is how the app is actually built is unknown.

**International transfers** (Chapter V):
- Likely candidates: APNs/FCM, Google or Apple Maps, Stripe, PayPal, and the cloud host. Many have US parent companies.
- Options: the EU-US Data Privacy Framework adequacy decision (EU) 2023/1795, which the General Court upheld in T-553/23 on 3 Sep 2025 (an appeal, C-703/25 P, was reported filed; current status unverified), or standard contractual clauses plus a transfer assessment.
- EU hosting alone doesn't prove compliance; US-parent access risk and processor terms still matter.

---

## 6. Transparency and rights

**App notice** (Arts 13/14) must cover:
- Controller(s) and contact, and the DPO if one is designated.
- Each purpose with its legal basis, as in §4. Legitimate interests stated explicitly.
- Camera and plate processing, including whether images are stored.
- Recipients: Ecurious, CPO, payment providers, GoingElectric (receives the device's IP and map area), push providers.
- Transfers, retention per category, and rights: access, rectification, erasure, restriction, objection to 6(1)(f), complaint.
- Automated fee logic and how to contest it.
- Show it before plate entry and before the first booking.

**Bay signage** (for people who don't use the app):
- Placed so drivers can read it **before** entering capture range and can still turn away (EDPB para 113; Saxon DPA).
- Wording "Kfz-Kennzeichenerfassung" with the DSK plate-capture symbol rather than only a CCTV icon (LDI NRW, Saxony).
- First layer: controller identity and contact, purpose (reservation check-in and bay occupancy), legal basis or interest, retention, recipients if surprising, rights, and a link or QR code to the full notice (EDPB paras 114–115).
- Signage only gives transparency. It doesn't make the processing lawful (Saxon DPA).

**Running rights requests:**
- **Access:** an app user gets their own bookings and plate events. A non-user must give the time window and prove they hold the vehicle (registration certificate) before anything is disclosed. Mask other people in any images (EDPB paras 92–95). If nothing is stored, say so (para 92).
- **Rectification:** for misread plates and wrongly charged fees.
- **Objection:** to 6(1)(f) camera processing, with a documented case-by-case review.
- **Deleting the account vs keeping records:** delete the profile, plates and events; keep only billing records and records for open disputes, separately, with restricted access and an expiry date.

---

## 7. DPIA (Art 35)

**Controlled hackathon demo:**
- A full DPIA is probably not legally required on these facts: one bay, informed participants, synthetic accounts, no public operation, short period.
- That conclusion comes from those facts, not from a "hackathon exemption", and it stops holding if the demo captures the public.
- Still worth doing: a one-page risk record (data map, purposes, retention, safeguards). The challenge's GDPR expectation and the documentation criterion reward it.

**Public pilot at a real public-access site:**
- Likely WP248 criteria: (3) systematic monitoring of a publicly accessible area; (8) innovative technology (camera-controlled gate access); (9) the processing decides access to a service; possibly (4) location data and (6) combining datasets with CPO or partner data.
- WP248: meeting two criteria will **in most cases** require a DPIA. Plan for one before the pilot.

**At scale (many sites, a network of plate events):**
- DSK must-list item 4: large-scale processing of whereabouts data, which names mobility services with position and billing data.
- Possibly Art 35(3)(c): systematic monitoring of a publicly accessible area on a large scale.
- If a DPIA is required, **§38(1) BDSG requires a German DPO regardless of headcount**. Otherwise the 20-person threshold and Art 37 apply. Not every camera needs a DPIA, but this growth path probably does.

---

## 8. Demo vs pilot vs scale

| Stage | Minimum controls |
|---|---|
| **Hackathon demo** | Only the provided bay and server. Team members' or consenting participants' vehicles, briefed in writing beforehand. Camera view limited to the bay. Sign at the bay during the demo. Synthetic accounts and Stripe test mode; no real cards or addresses. Real hardware and LPR stay in the demo. Plate events not persisted beyond the demo, or deleted afterwards (document when). No screenshots showing strangers' plates in slides. Credentials outside the repo. Participant consent is a fairness and transparency measure, not a blanket exemption: a passer-by or another team's car is still a non-user. |
| **Public pilot** | Roles settled and contracts signed (Art 28 / Art 26). Legitimate-interest assessment for non-users. DPIA. Signage before entry. Full notice. Retention configured on the hardware. Rights-request process. Breach process. Vendor and transfer checks. Contest and human-review path for fees. Decide whether to enforce against blockers. |
| **Scale / interop** | DPO assessment (§38 BDSG). OCPI booking exchange: send the plate only when the access method is `LICENSE_PLATE`, otherwise a token or code. Purpose limits in partner contracts. Records of processing (Art 30). Periodic deletion audits. Aggregate-only CPO KPIs. |

---

## 9. Proposed Notion wording (NOT APPLIED; for review)

**A. Replace** "for the app: licenseplate (if added more, one preffered), gps data, biometrics of user" with:
> for the app: license plate(s) – only the plate on the active booking is sent to the bay; location – only while the user is searching (foreground), never tracked in the background; **device unlock via phone's built-in Face ID/fingerprint/PIN – BayWatch never receives or stores biometric data**.

**B. After** "for the profile: adress, full name, email, phone number, payment profile", add:
> Minimise: email + name required; phone optional; no postal address unless invoicing requires it (small invoices ≤€250 don't need it); card details entered only in Stripe/PayPal/Apple Pay hosted forms – we store a token, never card numbers.

**C. New section "Privacy & license plate data (GDPR)"** after "what (personal) data to be collected":
> - Camera checks only: does the expected booking plate match? Output = matched / other vehicle / empty.
> - Other cars' plates are not stored (no fines for non-users in this version).
> - No video/audio recording; camera view limited to the bay; raw images deleted as soon as the plate event is created [confirm with Ecurious].
> - Plate events kept until booking end + [X] days dispute window, then deleted; billing records kept without plate/images.
> - Sign at the bay "Kfz-Kennzeichenerfassung" visible before entering; full notice via QR.
> - Alternative check-in without camera: app unlock / bay code.
> - Fees from camera events can be contested in the app; a human reviews disputes.
> - Roles (BayWatch / Ecurious / CPO) and Ecurious data handling: open questions.
> - Demo: only team/consenting test cars, test payment data, events deleted after demo.

**D. In "blocked bays"**, after "check if blocked every minute", add:
> (occupancy only – the waiting driver is never shown the other car's plate or image).

**E. In "bonus: give unused spots to business partners"**, add:
> (share availability only, no driver/plate data, unless a separate agreement and notice exist).

**F. "biometric or passcode" line** in the booking process: change to
> "confirmation via phone's built-in unlock (biometric or PIN)".

---

## 10. Follow-up decisions and fact requests

**Decisions for the team (with dependencies):**
1. **Biometrics:** OS-local only? This decides whether Art 9 applies. *Recommended: yes.*
2. **Blockers:** detect and reroute only, or also charge non-users a fee? Depends on #7 and the site terms. *Recommended: detect only for now.*
3. **Check-in alternative:** app unlock or bay code with equal standing? This underpins the Art 6(1)(b) argument.
4. **Images:** may BayWatch ever receive or keep images (disputes)? Depends on Ecurious facts A–C below.
5. **Retention numbers:** dispute window length for plate events and how long dispute evidence is kept.
6. **Profile fields:** drop the address? Phone optional? Depends on payment-provider and invoice needs.
7. **Who is the controller in the pilot:** BayWatch entity vs Ecurious vs CPO. Depends on Ecurious facts D–E.
8. **Location:** foreground-only, or opt-in background ETA for no-show detection?
9. **Fee automation:** auto-charge vs flag for review. Affects Art 22 safeguards and the dispute flow.
10. **Interop data:** what partners and OCPI receive (plate vs token).

**Fact requests for Ecurious or the operator:**
- A. Is plate recognition done on the device or on the server? Are full frames stored, where, and for how long, and can that be configured?
- B. What exactly is in the event payload (plate text, crop, confidence, other vehicles)?
- C. Can the camera view be masked? Is there audio? Is anything recorded while the bay is idle?
- D. Does Ecurious use the data for its own purposes (training, analytics)? Is there a data processing agreement or terms, and a subprocessor list?
- E. Who operates the test bay and site? Public or private body?
- F. Server hosting location. How the API authenticates (keys, webhook signing, replay protection).
- G. Is signage present at the venue bay, and who is named on it?

---

## 11. Source ledger (accessed 2026-10-24, 13:22–13:31 CEST unless noted)

**Plan and challenge**
- BayWatch plan (Notion block API, v201 → v216, last edit 13:29 CEST): https://www.notion.so/BayWatch-4032e6d9e3bb8033b730de17ef7f7b33
- Ecurious Challenge detailed (blocks last edited 09:59 UTC): https://sun-weather-eb6.notion.site/Ecurious-Challenge-detailed-3fe8e035358980409b1efb374df7d96d. The PDF attachment was not retrieved.

**EU**
- GDPR (EU) 2016/679, OJ text via EUR-Lex: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
  - Articles used: 4(1),(7),(8),(14); 5(1)(c),(e); 6(1)(a),(b),(f); 7; 9; 10; 11(2); 12–15; 21; 22; 25; 26; 28; 30; 32–35; 37; Chapter V.
  - A GDPR "Digital Omnibus" amendment is **still pending** as of today according to secondary sources (procedure 2025/0360(COD)). No change assumed.
- EDPB Guidelines 3/2019 on video devices, v2.0 (29 Jan 2020), paras 43–46, 92–95, 113–115, 121, 136–137, §5: https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201903_video_devices_en_0.pdf
- EDPB Guidelines 07/2020 on controller and processor, v2.1 (adopted 7 Jul 2021), paras 40, 52–56: https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf
- WP29 WP248 rev.01 on DPIA (4 Oct 2017, endorsed by EDPB), nine criteria and two-criteria rule: https://ec.europa.eu/newsroom/article29/redirection/document/47711
- EDPB Guidelines 1/2024 (legitimate interest) and 01/2025 (pseudonymisation): I could only confirm the draft or consultation stage. **Not relied on for conclusions.**
- CJEU judgments (EUR-Lex):
  - C-708/18 *TK*, paras 40, 46–47
  - C-252/21 *Meta Platforms*, paras 98–99, 106–109
  - C-319/22 *Scania*, paras 45–49
  - C-413/23 P *EDPS v SRB*, paras 71–77
  - C-439/19 *Latvijas Saeima*, para 93
- OCPI 2.3.0 Bookings module (EVRoaming Foundation GitHub, branch `2.3.0/release/bookings`, `mod_bookings.asciidoc`): `LICENSE_PLATE` / `TOKEN` / `ACCESS_CODE` access methods, `noshow_fee`, `NO_SHOW` state.
- EU-US Data Privacy Framework, T-553/23 and appeal C-703/25 P: secondary sources only; status unverified.

**Germany**
- BDSG §4 and §38: https://www.gesetze-im-internet.de/bdsg_2018/__4.html, https://www.gesetze-im-internet.de/bdsg_2018/__38.html
- TDDDG §25: https://www.gesetze-im-internet.de/ttdsg/__25.html
- AO §147: https://www.gesetze-im-internet.de/ao_1977/__147.html
- UStDV §33: https://www.gesetze-im-internet.de/ustdv_1980/__33.html
- DSK guidance on video surveillance by private bodies (17 Jul 2020; footnote 8 cites BVerwG 6 C 2.18 para 47; 72-hour passage; signage annex; DPIA §3.4): https://www.datenschutzkonferenz-online.de/media/oh/20200903_oh_v%C3%BC_dsk.pdf
- DSK DPIA must-list v1.1 (items 1, 4, 5, 6): https://www.datenschutzkonferenz-online.de/media/ah/20181017_ah_DSK_DSFA_Muss-Liste_Version_1.1_Deutsch.pdf
- LDI NRW, plate capture at parking sites: https://www.ldi.nrw.de/kfz-kennzeichenerfassung-parkplatz
- Saxon DPA, parking enforcement: https://www.datenschutz.sachsen.de/datenschutz-bei-parkraumueberwachung-6484.html
- DSK resolution of 6 Nov 2019 (police plate recording; context only, title from search, not read in full): https://www.datenschutzkonferenz-online.de/media/en/20191106_entschlie%C3%9Fung_keine_autom_kennzeichenerfassung_dsk.pdf

**Data source terms**
- GoingElectric API terms (retrieval from the end device, 24-hour cache limit, free and without registration, source attribution): https://www.goingelectric.de/stromtankstellen/api/terms/

**Not verified or not found:**
- Any official Ecurious documentation.
- Whether the AFIR ad-hoc charging rules affect a gated reserved bay (a non-privacy issue to flag to Sol).
- Final status of EDPB Guidelines 1/2024 and 01/2025, and of the Digital Omnibus.
- Full text of the LDI NRW annual report chapter on plate capture.
- How Austrian DSB practice compares (seen only in search results).

**Limits:** law and guidance checked against the sources listed above. Hardware, vendors and roles are unknown, and the plan was still changing at the final recheck (13:31 CEST).
