# Sprint 37 — ICU/HDU bed-flow (EPIC-25)

**Status:** done
**Epic:** EPIC-25 — Specialty Expansion (R6). ED (S21), theatre (S23), blood bank (S24), dialysis (S34), equipment (S35), roster (S36) done.
**Specs:** CLIN-001 §13 Admission/Ward/Bed Management (bed selection by availability/isolation/specialty; bed reservation alone is not admission; higher-acuity bed required → ICU/HDU workflow; §13.2 internal transfer closes previous stay and opens new assignment) + ED disposition (S21) and theatre post-op transfer to ICU (S23) as producers of ICU demand; ARCH-001/DB-001 §9–§10 location hierarchy (Sprint 27: `org.unit` + `org.location` kind=bed) as the bed inventory.

## Scope

- [x] Migration `0032_icu_bedflow.sql`: additive `org.location` columns (`level_of_care` ward|hdu|icu, `isolation_capable`, `out_of_service` + reason — beds ARE `org.location` rows with kind='bed'); new `flow` schema: `flow.bed_assignment` (active|ended, **partial UNIQUE** one-active-per-bed and one-active-per-encounter), `flow.level_of_care` (current level per encounter, history preserved, partial UNIQUE one-active).
- [x] Domain pure: `effectiveLevel` (no level row ⇒ ward), `bedAcceptsLevel` matrix (icu bed ⇒ icu only; hdu bed ⇒ hdu|icu; ward bed ⇒ any), `isBedAvailable` (not out-of-service, no active assignment).
- [x] Module `bedflow` (port + Kysely repo + service + guarded controllers `/beds` + `/levels`, DI `ENCOUNTER_REPOSITORY`): configure bed, out/in-of-service, list available beds (level/isolation filters), assign/release/transfer, set + read level of care (current + history + effective), list assignments. Privileges `bed:read`/`bed:manage`; audited; outbox events (`flow.bed_configured|out_of_service|in_service`, `flow.bed_assigned|released|transferred`, `flow.level_of_care_set`).
- [x] Guards: encounter must exist + be open|admitted (409 ENCOUNTER_NOT_ACTIVE); bed exists (404 BED_NOT_FOUND); level set on bed (422 BED_LEVEL_UNSET); facility match (422 FACILITY_MISMATCH); out-of-service or occupied (409 BED_UNAVAILABLE / BED_OCCUPIED); encounter already bedded on assign (409 ENCOUNTER_ALREADY_IN_BED — use transfer); ICU/HDU level gate (422 LEVEL_OF_CARE_REQUIRED); release/transfer require active assignment (409 NO_ACTIVE_ASSIGNMENT); reasons ≥5 chars (422).
- [x] Tests: unit (2 specs, 7 tests: level matrix/availability pure + service fakes for full guard cascade), integration live PG (1 comprehensive: ICU escalation flow level-gate → configure → available list → assign → occupied/already-in-bed → transfer (old ended) → release → de-escalation with history → oos guards → discharged guard → outbox 7 event types → **DB partial-unique backstop proven with direct SQL insert**), e2e DB-less (4 × 403/400 above sentinel).

## Non-goals

- Encounter/ADT write-through (encounter.transfer rows + encounter.bed text stay ADT-owned; bedflow emits outbox events with encounterId — sync is a later integration), discharge flows (encounter module owns ADT), bed requests/waitlists (no-bed escalation is process + follow-on), nurse-staffing per bed, isolation *matching* rules beyond the flag (sex/age rules per CLIN-001 §13.1 are facility policy config — follow-on), cleaning/turnover cycles.

## Decisions

- **D1** — Beds are NOT a new table: they are `org.location` rows (kind='bed') from the Sprint 27 hierarchy, enriched additively with `level_of_care`, `isolation_capable`, `out_of_service(+reason)`. One place inventory, zero data migration, theatre/clinic locations untouched.
- **D2** — Occupancy truth is the active `flow.bed_assignment` row — CLIN-001 13.1 "bed reservation alone is not admission". Partial UNIQUE indexes make double-booking impossible at the DB level (one active per bed, one active per encounter) — proven in the integration test with a raw insert, not just the service guard.
- **D3** — ICU/HDU workflow gate (13.1 "higher-acuity bed required → ICU/HDU workflow"): assigning to an icu bed requires the encounter's *current* level of care to be icu; hdu beds accept hdu or icu (overflow); ward beds accept any. Effective level defaults to ward when no level row exists. Assistive — set the level first, then the bed.
- **D4** — Level-of-care history is append-only: setting a new level ends the previous active row (partial UNIQUE one-active) — latest prominent without erasing prior values (same principle as ED acuity from S21).
- **D5** — Bedflow does not write `encounter.transfer` or `encounter.bed` (ADT owns those); it publishes outbox events carrying `encounterId` so ADT sync can subscribe later. Boundaries stay clean; no cross-module write coupling.
- **D6** — Taking an occupied bed out of service is refused (409 BED_OCCUPIED): empty the bed first — keeps oos a state of *available* beds only.

## Evidence (live proof, container `pulse-pg-s37`)

| Gate | Result |
|---|---|
| Migration | `0001`→`0032` applied on fresh DB |
| Integration (live PG) | **75/75 across 33 files**, 2nd consecutive run on same DB (idempotent); `bedflow.integration-spec.ts` 1/1 comprehensive ICU escalation (level gate, isolation filter, transfer with old-ended, de-escalation history, oos/occupied/discharged guards, 7 outbox event types, DB unique backstop) |
| Unit | **265/265** across 55 files (bedflow: 7 across 2 specs) |
| e2e | **101/101** (+4 beds/levels 403/400 above sentinel) |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 318 files after fixing 2 warnings: useless-spread + unused import; boundaries 224; secrets clean) |
| Build | `pnpm build` 9/9 |

## Follow-ons

- Remaining EPIC-25: research governance.
- ADT write-through (encounter.transfer rows + encounter.bed sync via outbox consumer); bed request/waitlist with escalation when no ICU bed available (CLIN-001 13.1 no-bed path); isolation/sex/age matching rules; cleaning/turnover status; roster↔bedflow link (ward assignment → default patient list per IAM-001 §46); critical-care scoring/flowsheets.
