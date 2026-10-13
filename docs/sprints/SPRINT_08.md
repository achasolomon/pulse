# Sprint 08 — Imaging + Medication/eMAR (complete R2)

Goal: diagnostics closes — imaging order-to-final-report with PACS references (pixels never in Postgres), and prescribe-to-administer with pharmacist verification and accountable eMAR.
Status: Done (closed 2026-10-08)
Specs: IMG-001, MED-001, DB-001 §25–§30, ARCH-001 §18/§20

## Scope

- [ ] F11.1 Imaging order/schedule/protocol; F11.2 study linkage (StudyUID + PACS ref, pixels stay out); F11.3 viewer launch authorization stub; F11.4 report draft→final→amended (new version)
- [ ] F12.1 Prescribing (structured dose/route/frequency); F12.2 pharmacist verification; F12.3 dispense (batch traceable); F12.4/F12.5 eMAR administrations; F12.6 not-given/held/correction with reason
- [ ] Guards: laterality required for paired structures (order validation); verify-before-dispense; dispense-before-administer; terminal-state discipline
- [ ] Tests: unit (both machines + service fakes), integration live PG (imaging full chain; med full chain + held path), e2e DB-less (403/400)

## Non-goals

- Real PACS/DICOM C-STORE, dose calculators, interaction checking (CDS boundary → later); inventory decrement hooks to pharmacy stock (R3).

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0007` for real
- `test:int` 10/10 green incl. `diagnostics.integration-spec.ts`: imaging order→final with PACS ref + report versions [1,2]; med prescribe→verify→dispense→given+not-given→held
- Regression: build 9/9, unit 40/40, e2e 18/18 (new: imaging 403, meds 400), oxlint 0/0 (101 files), boundaries ok (78 files)
- R2 diagnostics now complete (EPIC-09/10/11/12). Verify container removed.

## Pending

- None. Sprint 08 closed. Next: Sprint 09 — R3 operations (inventory EPIC-13 + revenue EPIC-14 + workflow EPIC-15).
