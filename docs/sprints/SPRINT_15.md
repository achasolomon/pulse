# Sprint 15 — Close R1/R3 Remainders + Reporting Baseline

Goal: finish everything left open in R0–R3 — nursing handover baseline, governed export, and the first operational reports. No migration (all reads over existing tables).
Status: Done (closed 2026-10-08)
Specs: CLIN-001 (handover), ENG-001 §88 (export), ARCH-001 §24 (reporting)

## Scope

- [ ] F07.3 Handover baseline: `GET /clinical/handovers?facilityId=` — active encounters with patient banner data, active problems, open tasks, recent critical items; composed via repository ports only
- [ ] F15.4 Governed export: `GET /clinical/patients/:id/export` — JSON bundle (summary + timeline + entries + documents metadata), audited, outbox `export.generated`
- [ ] EPIC-20 (baseline): `GET /reports/census`, `/reports/revenue`, `/reports/claims` — derived read models, no new tables, facility-scoped
- [ ] Tests: unit (report math pure + service fakes), integration live PG (seed → handover/export/reports reflect it), e2e DB-less (403/400)

## Non-goals

- Warehouse feeds, regulatory extracts, PDF rendering (export is JSON first; rendering later).

## Evidence (live-DB proof 2026-10-08)

- No migration needed (reads over 0001–0013); migrate re-run clean
- `test:int` 23/23 green incl. `closure.integration-spec.ts`: handover (census/problems/allergies/tasks) + export bundle + census/revenue/claims reports reflecting seeded money
- Regression: build 9/9, unit 76/76, e2e 30/30 (new: handover + reports 403s), oxlint 0/0 (165 files), boundaries ok (126 files)
- Fixes: fused listActive/listHistory edit repaired; clinical module import depths (module file = `../../platform`, `../sibling`); older fakes extended for new port methods. Verify container removed.
- R0–R3 now fully closed (F07.3, F15.4, EPIC-20 done).

## Pending

- None. Sprint 15 closed. Remaining: EPIC-19 portal, R5 hardening (EPIC-21/22/23/24), R6 specialties, Phase-2 insurance.
