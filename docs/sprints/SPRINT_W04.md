# W04 — Outpatient check-in and staff worklists

Status: In progress. Started 2026-10-14.

The delivered slice connects the staff roles the user identified: registration, front desk check-in, nursing vitals and consultation handoff. Worklists show actual persisted visit stages; they do not imply clinical completion or replace the remaining encounter/documentation scope.

## Delivered workflow

1. Records staff use **Patients → Register patient**. Required identity fields are given/family name, date of birth and sex; phone/address are optional. The server generates a facility-scoped MRN. A matching surname/date of birth opens duplicate review; a separate record requires an explicit confirmation. Registration details remain available without clinical chart access.
2. Reception staff use **Patients → Check in → Confirm check-in**. Records staff with check-in privileges can use the same action immediately after registration; the local `demo.records` account includes this capability. A walk-in creates one open outpatient encounter and one waiting-vitals visit. An existing active visit is reused. The backend also accepts an eligible scheduled appointment ID; appointment selection/booking UI remains pending.
3. Nurses use **Staff worklists → Vitals → Start vitals**. Claiming assigns the visit exclusively and creates an encounter-linked care assignment. Other nurses cannot claim or record against that visit. The assigned nurse can open the chart and use **Record vitals** there or in the worklist.
4. The vitals drawer records measured values and measurement time. BP values must be paired; unentered values remain unrecorded. Values retain units and are attributed to the authenticated actor. Save and cancel remain visible in the drawer footer on desktop and mobile.
5. **Send to consultation** requires saved vitals and an explicit eligible clinician selection. Handoff creates the clinician's care assignment, removes the visit from the nurse's vitals queue and adds it to that clinician's consultation queue. **Start consultation** opens the chart with the in-consultation stage. Nursing write actions stop after handoff.

The patient chart includes active visit status and available staff actions. Worklists refresh every 15 seconds while visible, on window focus and after a staff action. They currently show at most 100 active visits, oldest first. Consultation worklists contain only visits assigned to the current clinician. Front desk sees the facility's active flow.

## Persistence and authorization

Migration `0037_outpatient_staff_flow.sql` adds visits, stage history, actor-scoped command receipts, registration contacts, a generated MRN sequence and observation attribution. Every command uses the current authenticated membership and selected organization/facility; submitted scope cannot override those values. Mutation state, command receipt, audit and outbox events commit in one transaction. Reusing a submission key with a changed payload returns a conflict. Different check-in submissions for one patient reuse the active visit; row locks protect nurse ownership and stage changes.

Consultation eligibility uses the latest active membership and an active credential. Vitals recording additionally checks the encounter-linked care assignment. Legacy staff vitals calls cannot bypass an active outpatient visit's worklist, and legacy encounter opening/reads reject inconsistent patient/facility scope. Stage changes use the `outpatient_visit` aggregate; observations use the clinical producer. Clinical measurement values and identity narratives are excluded from audit/outbox payloads and command receipts.

## Verification

- Real PostgreSQL/HTTP workflow tests cover registration retries, duplicate review/confirmation, generated MRNs, single active visit, nurse ownership/care access, measurement validation, retry-safe observations, handoff, clinician queue/start, latest membership, revoked care and legacy scope/bypass rejection.
- Chrome covers the actual records → reception → nurse → doctor UI, desktop side drawers, mobile bottom drawers, chart values and consultation assignment. Evidence is under ignored `tmp/outpatient-evidence`.
- Local demo accounts and queue endpoints are verified against normal localhost:3001; automated clinical mutations run against disposable PostgreSQL on 5437.

## Remaining scope

Appointment booking/rescheduling/cancellation, appointment-linked check-in UI, queue pagination beyond the current bound, priority/triage protocols, queue reassignment/cancellation, visit completion, advanced nursing care plans, orders and critical clinical notifications remain in their owning catalogue/sprint scope. Authored nursing/consultation notes, signing and addenda are delivered in [W05](SPRINT_W05.md). The header inbox currently delivers nonclinical task assignments; this slice's clinical routing is visible through worklists and does not claim bell delivery for every handoff.
