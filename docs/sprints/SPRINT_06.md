# Sprint 06 — Scheduling + Vitals + Clinical Notes (close R1 slice)

Goal: complete the first end-to-end visit — book → check-in → queue → vitals → signed note (+addendum) → problem/allergy record → patient timeline.
Status: Done (closed 2026-10-07)
Specs: CLIN-001 §5–§6, DB-001 §16–§20, ARCH-001 §2 (immutable signed facts)

## Scope

- [ ] F05.1/F05.4 booking + cancel/reschedule/no-show; F05.2 check-in; F05.3 facility queue worklist
- [ ] F07.1/F07.2 triage + vitals as typed observations (DB-001 §19–§20)
- [ ] F08.1/F08.2 note draft → sign (immutable); F08.3 addendum/correction; F08.4 problem/allergy entries; F08.5 patient timeline
- [ ] Tests: unit (appointment machine, note-sign guard), integration vs live PG (full visit chain), e2e DB-less (403/400)

## Non-goals

- Recurring schedules, provider rosters, nursing handover tasks (F07.3 baseline deferred to Sprint 07 with orders).

## Evidence (live-DB proof 2026-10-07)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0005` for real
- `test:int` 7/7 green incl. `visit.integration-spec.ts`: book→check-in→queue→register→open→vitals→draft→sign→double-sign-refused→addendum→problem→timeline (all 5 kinds)
- Regression: build 8/8, unit 25/25, e2e 14/14 (new: appointments 403, notes 400), oxlint 0/0 (78 files), boundaries ok (60 files)
- Fixes: module import depths (scheduling/clinical); `status` insert-optional already patterned
- R1 vertical slice (§12–§13) now demonstrable end-to-end minus vitals-UI. Verify container removed.

## Pending

- None. Sprint 06 closed. R1 remaining: EPIC-05 queue UI + EPIC-07 handover baseline (Sprint 07), then R2 diagnostics.
