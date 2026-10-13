# Sprint 20 — Benefit Engine (CR-001 Phase 2a)

Goal: insured splits computed from plan rules, not typed by hand — deductible tracked per member-year, then copay, then coinsurance, with the payer taking the remainder. Allocation invariant still holds on every write.
Status: Done (closed 2026-10-11)
Specs: CR-001 Phase 2, ADR-007, REV-001

## Scope

- [ ] `ins.plan_benefit` (versioned by effective date) + `ins.deductible_use` ledger (charge-linked, idempotent re-apply)
- [ ] Pure `computeSplit()` — deductible → copay → coinsurance order; patient + payer always sum to gross; edge cases (gross < deductible, copay > remainder, 0%/100%)
- [ ] `InsuranceService.applyBenefits()` — loads charge/coverage/benefit, posts deductible use once per charge, writes allocation through the revenue-owned port
- [ ] Endpoints: benefit define + apply; re-apply is safe (deductible posted once)
- [ ] Tests: unit (engine matrix + service fakes), integration live PG (full benefit chain + idempotent re-apply), e2e DB-less (403/400)

## Non-goals

- EDI/remittance, auto-charging, capitation (Phase 2b+, separate sign-off).

## Evidence (live-DB proof 2026-10-11)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0016` for real
- `test:int` 27/27 green incl. extended `insured-billing`: tariff → benefit split (5000/500+1300/3600) → deductible ledger → idempotent re-apply → second charge with exhausted deductible
- Regression (cash parity): build 9/9, unit 99/99, e2e 41/41 (new: benefit 403/400), oxlint 0/0 (192 files), boundaries ok (145 files), secrets clean — pre-existing suites green unmodified
- Fixes: missing `ins.*` table types; narrow-inferred fake annotations; duplicate fake entries; nested-DTO validators. Verify container removed.

## Pending

- None. Sprint 20 closed. CR-001 Phase 2a complete. Remaining Phase 2: EDI/remittance, auto-charging, capitation (separate sign-off).
