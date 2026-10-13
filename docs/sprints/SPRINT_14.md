# Sprint 14 — CR-001 Phase 1b: Allocation, Eligibility, Preauth, Claim Depth

Goal: insured billing works end-to-end — every charge split across responsible parties summing exactly to its total, eligibility evidenced, preauth decided before submission, claims versioned per submission.
Status: Done (closed 2026-10-08)
Specs: CR-001 §§4–7, ADR-007, REV-001

## Scope

- [ ] Responsibility allocation: `rev.allocation` via revenue-owned port; invariant `sum(shares) == charge total` enforced + tested; per-party outstanding endpoint
- [ ] Coverage snapshot: nullable `encounter.coverage_id` (+ guarantor fields on patient, nullable); set-and-audit endpoint
- [ ] Eligibility log: `ins.eligibility_check` with manual evidence + verified-by/at; result eligible/ineligible/partial
- [ ] Preauth machine: `ins.preauth_case` requested → docs-requested ⇄ requested → approved/denied (+ expired/cancelled), line items, decision + expiry
- [ ] Claim depth: `rev.claim_line` (charge-sourced lines) + `rev.claim_submission` versions (resubmit = new version)
- [ ] Cash parity re-proven: all pre-existing suites green unmodified
- [ ] Tests: unit (allocation invariant pure + service fakes; preauth machine), integration live PG (full insured chain), e2e DB-less (403/400/422)

## Non-goals (Phase 2)

- Benefit engine math, EDI/remittance, auto-charging, capitation.

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0013` for real
- `test:int` 21/21 green incl. `insured-billing.integration-spec.ts`: tariff price → 80/20 allocation → drift rejected → eligibility → preauth docs→approve → invoice per-party 9000 → claim lines + versions [1,2]
- Regression (cash parity): build 9/9, unit 72/72, e2e 28/28 (new: allocate 400), oxlint 0/0 (157 files), boundaries ok (121 files) — all pre-existing suites green unmodified
- Fixes: port-extension fallout in 3 older fakes; preauth `decision_note` insert-optional; nested-DTO validators (forbidNonWhitelisted rejects undecorated fields); v4-UUID note for `:id` e2e params; e2e allocate split into 400-validation (DB-less) + 404 unit + live integration. Verify container removed.

## Pending

- None. Sprint 14 closed. CR-001 Phase 1 complete. Next: Phase 2 (benefit engine, EDI/remittance, auto-charging — separate sign-off) or R5 hardening.
