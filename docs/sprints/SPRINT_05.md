# Sprint 05 — Encounter & ADT Core (EPIC-06)

Goal: every care contact runs inside an explicit encounter with a governed lifecycle — open → admit → transfer* → discharge, or open → cancelled. No orphan clinical writes after this.
Status: Done (closed 2026-10-07)
Specs: CLIN-001 (encounter/ADT), DB-001 §14–§15, ARCH-001 §2 (patient+encounter+org context on every tx)

## Scope

- [ ] F06.1 Open encounter (outpatient/inpatient/emergency; patient must exist + be active; `encounter.opened` outbox)
- [ ] F06.2 Admission (open→admitted with department/bed; `encounter.admitted`)
- [ ] F06.3 Transfer (admitted→admitted with new department/bed, history row; `encounter.transferred`)
- [ ] F06.4 Discharge (admitted→discharged with disposition; open→discharged allowed for outpatient/emergency; `encounter.discharged`) + cancel (open→cancelled)
- [ ] Guards: retired-duplicate patient cannot open; illegal transitions rejected with `ENCOUNTER_TRANSITION` 422; all endpoints tenant-scoped + `encounter:*` privileges + audited
- [ ] Tests: unit (pure machine + service with fakes), integration vs live PG (full lifecycle + history + outbox), e2e DB-less (403/422 cases)

## Non-goals

- Scheduling/appointments (EPIC-05 → Sprint 06), vitals/notes (EPIC-07/08 → Sprint 06/07), bed inventory management (ward stock → R3).

## Evidence (live-DB proof 2026-10-07)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0004` for real
- `test:int` 6/6 green (org 2, patient 2, encounter 2: full open→admit→transfer→discharge with history + outbox; illegal-transition rejections)
- Regression: build 8/8, unit 19/19, e2e 12/12 (new: encounters 403/400), oxlint 0/0 (63 files), boundaries ok (48 files)
- Fixes in-session: encounter module import depths; `status` insert-optional already covered; DTO-spread lint; integration assertion now matches API error text (`Illegal transition`, code `ENCOUNTER_TRANSITION` in body)
- Verify container removed; compose stays canonical on 5432

## Pending

- None. Sprint 05 closed. Next: Sprint 06 — scheduling (EPIC-05) + triage/vitals + clinical notes to complete the R1 vertical slice.
