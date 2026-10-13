# Sprint 04 — Patient Identity & Registration (EPIC-04)

Goal: safe patient identity before care — register with facility MRN, search with minimum-necessary display, duplicate review that never auto-merges, governed merge preserving history.
Status: Done (closed 2026-10-07)
Specs: CLIN-001 §4, DB-001 §11–13 + §66, FHIR-001 §8 (identifier namespaces), IAM-001 (scoping), PRIV-001 (minimum-necessary)

## Scope

- [ ] F04.1 Registration: `patient.patient` + `patient.identifier` (canonical + facility MRN + external namespaces), `POST /patients` guarded (`patient:write`) + audited + `patient.registered` outbox
- [ ] F04.2 Search: `GET /patients/search?q=&facilityId=` — identifier-exact + name-prefix, facility-scoped, min-necessary fields only, `patient:read`
- [ ] F04.3 Duplicate review: deterministic candidate rules (exact identifier → CONFIRMED risk; same surname+DOB → REVIEW), `GET /patients/:id/duplicates`, never auto-merges
- [ ] F04.4 Merge: `POST /patients/:id/merge` (`patient:merge` privilege) — `patient.merge_link` row, survivor wins identity, duplicate retired (not deleted), `patient.merged` outbox + audit
- [ ] F04.5 Banner data: `GET /patients/:id/summary` — single endpoint the web banner consumes (demographics + active flags + MRN)
- [ ] Tests: unit (scoring pure + service with fake repo), integration vs live PG (register→search→dup→merge→history), e2e DB-less (403s + 400 validation only)

## Non-goals (later)

- Biometric matching, nationwide MPI, photo handling, full demographics history — deferred per Blueprint §1.2.

## Evidence (live-DB proof 2026-10-07)

- Postgres 16 via docker on host 5433 (host 5432 occupied): `db-migrate` applied `0001`+`0002`+`0003` for real
- `test:int` 4/4 green: org 2/2 + patient 2/2 (register→REVIEW detect→merge→retired-duplicate+link, survivor active; MRN search within facility)
- Regression: build 8/8, unit 14/14, e2e 10/10 (new: patients 403-no-context, 400-validation), oxlint 0/0 (55 files), boundaries ok (42 files)
- Fixes in-session: patient `status` insert-optional type; module import depths; DTO-spread lint; fake-repo counter closure bug caught by unit test
- Verify container removed; compose stays canonical on 5432

## Pending

- None. Sprint 04 closed. Next: Sprint 05 — encounter/ADT + scheduling (EPIC-05/06) on this identity foundation.
