# Sprint 21 — Emergency Care Slice (R6 specialties start)

Goal: run an ED visit safely — acuity-scored triage, acuity-ordered waiting list with waiting-time visibility, and disposition tracking on emergency encounters.
Status: Done (closed 2026-10-11)
Specs: CLIN-001 (emergency paths), PULSE-SAFE-001 (acuity under-triage is a hazard — scoring is assistive, clinician confirms)

## Scope

- [ ] `emg.acuity` (encounter-scoped, level 1–5 + discriminator + recorder; re-score appends, never overwrites)
- [ ] Waiting list: `GET /emergency/waiting?facilityId=` — admitted/open emergency encounters ordered by acuity then arrival, with minutes-waiting computed server-side
- [ ] Disposition: close the loop via encounter discharge (admit/transfer/home/expired) + length-of-stay read on the record
- [ ] Guardrails: acuity required before disposition of emergency encounters (422 otherwise); level-1 must have `stat` urgency lab/imaging or documented override reason
- [ ] Tests: unit (acuity ordering pure + service fakes), integration live PG (arrive→score→waiting→disposition), e2e DB-less (403/400)

## Non-goals

- Theatre/ICU/dialysis/blood-bank/equipment/roster (R6 later slices), ambulance dispatch, bed management.

## Evidence (live-DB proof 2026-10-11)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0017` for real
- `test:int` 28/28 green (17 files) incl. `emergency.integration-spec.ts`: ungated disposition refused → score → acuity-ordered waiting → guarded discharge
- Regression: build 9/9, unit 103/103, e2e 43/43 (new: emergency 403/400), oxlint 0/0 (199 files), boundaries ok (150 files), secrets clean
- Fixes: Kysely join column-vs-literal (`onRef`); shared `toDateOnly()` for DATE columns (weekday-text + UTC-shift bugs) with spec, applied to 5 sites — this had been silently defeating duplicate detection across system boundaries; sync pre-check now stricter than online by design; insured-billing fixtures made run-unique (member ledger accumulates by design)
- Verify container removed.

## Pending

- None. Sprint 21 closed. Remaining: R6 specialties (theatre/ICU/dialysis/blood-bank/equipment/roster), EPIC-21 runtime, Phase-2b insurance, Next 15.
