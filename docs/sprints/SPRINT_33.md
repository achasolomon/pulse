# Sprint 33 — EPIC-24 close: Cutover rehearsal + representative clinical seed

**Status:** done
**Epic:** EPIC-24 — Migration, Onboarding & Go-Live (MIG-001, ONB-001; R5)
**Closes:** tracker remainder "cutover rehearsal at pilot" (SPRINT_18 delivered the twice-safe facility/catalogue seed + onboarding runbook).

## Scope

- [x] `infra/seeds/demo-clinical.sql` — twice-safe representative clinical data (3 patients + MRNs, 3 encounters across outpatient/admitted/discharged, 2 signed + 1 draft notes, 1 transfer) so go-live readiness (ONB-001 §432, Appendix C "Patient identity / Clinical") and the rehearsal's clinical sample check have real rows to validate.
- [x] `scripts/cutover-rehearsal.mjs` — timed dress rehearsal (MIG-001 §77, Appendix B): baseline manifest → idempotent delta fixture (§80) → target schema via migrations only → freeze verification (§79) → data-only load → automated reconciliation (mismatch = M0 → NO-GO, MIG-SR-015) + clinical sample validation → rollback decision drill (measured) → JSON verdict + phase timings → cutover window estimate with contingency (§78). `--self-test` asserts the NO-GO math; `--docker <c>` / local pg modes; `--keep-target` for inspection.
- [x] `docs/runbooks/cutover-rehearsal.md` — script ↔ MIG-001 phase map, Appendix C checklist split into script-verified vs manual authority sign-off, T-30→T0 timeline (§83), defect classes, rollback decision rules.
- [x] Evidence: live two-database rehearsal run twice → GO both runs; full regression gates green.

## Non-goals

- API/UI surface for rehearsals (operational milestone, script + runbook only).
- Real cross-region cutover, legacy proprietary source connectors, PACS/document binary transfer (manual areas in the runbook).
- New migration (schema unchanged; next migration remains `0029`).

## Decisions

- **D1** — Source is system of record for data **and** configuration: target is migrated, then migration-seeded rows (e.g. `ops.alert_rule` with `now()` timestamps) are cleared before the data-only load. The cleared+migrated state is also the deterministic rollback target (fresh seeds carry run-varying timestamps, so raw fresh-migrate manifests are not byte-stable).
- **D2** — Data-only load with `--disable-triggers` (circular FKs: department/location/anatomy_structure/finding); `integration.schema_migrations` excluded from dump (target's own migration bookkeeping wins).
- **D3** — Freeze proof = source manifest byte-identical between transfer baseline and post-load; any source write during the window fails the run (§79, no ambiguous dual-write).
- **D4** — Rehearsal is repeatable end-to-end: every run drops/recreates `TARGET_DB` (`pulse_cutover`), so it doubles as its own rollback drill (§77) and leaves no residue.
- **D5** — No API surface: EPIC-24 remains tooling/runbook + sign-off work; matches SPRINT_18 precedent.

## Evidence (live proof, container `pulse-pg-s33`)

| Gate | Result |
|---|---|
| Seeds | `demo-facility.sql` applied (idempotent, all `INSERT 0 0` on re-run); `demo-clinical.sql` run 1 = 3 patients/3 identifiers/3 encounters/1 transfer/3 notes, run 2 = all 0 |
| Rehearsal run 1 | **GO** — 98 tables, 47 rows, delta idempotent, freeze clean, clinical sample 3/3/3/2 signed, 0 defects, rollback drill clean (5s), window estimate 11s |
| Rehearsal run 2 | **GO**, exit 0 (repeatable; estimate 9s) |
| NO-GO math | `--self-test` pass (mismatch + missing-in-target + missing-in-source detected; clean compare = 0 defects) |
| Integration (live PG) | **67/67 across 29 files** (demo data added; suites RUN-scoped — no regressions) |
| Unit / e2e / build | **238/238**, **85/85**, `pnpm build` 9/9 |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 286 files; boundaries 204; secrets clean) |

Live fixes: PK collision on migration-seeded rows during data-only restore (D1); rollback clean-check made deterministic (D1); self-test assertion caught a missed missing-in-source defect class.

## Follow-ons

- Pilot: run the rehearsal at representative scale (real data volume) at T-7 and record timings in the T0 minute plan (MIG-001 §915).
- Manual Appendix C areas (finance/inventory/active-orders sign-off) exercised with real pilot stakeholders.
- Machine-readable API contract artifact (vertical-slice exit checklist) — separate item if/when EPIC-24 is revisited.
