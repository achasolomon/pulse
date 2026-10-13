# Sprint 13 — Insurance Foundation (CR-001 Phase 1a, additive)

Goal: payer/contract/tariff foundation with zero behavior change — new tables, read-only seams, dark price resolution. Cash paths untouched.
Status: Done (closed 2026-10-08)
Specs: CR-001 §§4–6, ADR-007, REV-001

## Scope

- [ ] Migration `0012_insurance_foundation.sql`: `ins.payer`, `ins.facility_contract`, `ins.tariff_schedule`, `ins.tariff_line` + nullable `rev.charge.tariff_id`
- [ ] `modules/insurance/`: payer/contract/tariff CRUD (behind `payer:manage`), tariff publish (new version), dark `resolvePrice()` (called by nothing)
- [ ] Tests: unit (price matrix incl. fallback + version precedence), integration live PG (seed → resolve contract vs default), e2e DB-less (403/400)
- [ ] Proof that cash paths are untouched: full existing suite green unmodified

## Non-goals (Sprint 14, needs Phase-1 design sign-off)

- Allocation writes, coverage snapshot, eligibility log, claim lines, preauth machine, any change to `RevenueService`.

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0012` for real
- `test:int` 20/20 green incl. `insurance.integration-spec.ts`: contract + v1/v2 schedules resolve 4000/4500 by date; unmatched service falls back empty
- Regression (cash untouched): build 9/9, unit 63/63, e2e 27/27 (new: insurance 403), oxlint 0/0 (154 files), boundaries ok (121 files) — all pre-existing suites green unmodified
- Fixes: controller rewrite (bad placeholder), schedule-line validation, e2e premature-close + sentinel comment, unused imports. Verify container removed.

## Pending

- None. Sprint 13 closed. Next: Sprint 14 — CR-001 Phase 1b (allocation, coverage snapshot, eligibility log, claim lines, preauth) needs design sign-off.
