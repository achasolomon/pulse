# Sprint 38 — Research governance (EPIC-25, final slice)

**Status:** done
**Epic:** EPIC-25 — Specialty Expansion (R6) — **CLOSED** with this sprint. ED (S21), theatre (S23), blood bank (S24), dialysis (S34), equipment (S35), roster (S36), ICU/HDU bed-flow (S37), research governance (S38).
**Specs:** BACKLOG-001 (Research = cohort/query governance, de-identification/pseudonymization, approvals, export controls, provenance); IAM-001 §20 (research is an approved purpose of use; research access uses approved data scope / de-identification); ANAT-001 §38 (population research = governed de-identified/pseudonymised dataset); SEC-001 (pseudonymization for analytics/research); ARCH-001 (enforcement at research extraction).

## Scope

- [x] Migration `0033_research.sql` (`res` schema): `res.study` (facility, unique code, title, status draft|approved|closed, approved-requires-approver CHECK), `res.cohort_definition` (versioned governed queries, draft|approved, UNIQUE study+name+version, criteria jsonb governed artifact), `res.dataset_export` (requested→approved|denied; approved→exported; exported→revoked; requested patient snapshot array; row_count CHECK on exported), `res.subject_link` (re-identification vault: pseudonym per study+patient, UNIQUE both ways).
- [x] Module `research` (port + Kysely repo + service + guarded controller `/research`, DI `PATIENT_REPOSITORY`): studies create/list/get/approve/close; cohorts create/list/approve (auto-versioned); exports request/approve/deny/generate (pseudonymise + row_count)/revoke; subject vault listing. Privileges `research:read`/`research:manage`; audited; outbox events for the full approval + export chain (9 types).
- [x] Guards: coded exceptions throughout — STUDY_CODE_EXISTS 409; STUDY/COHORT/EXPORT_STATE_INVALID 409; STUDY_NOT_APPROVED/COHORT_NOT_APPROVED/COHORT_STUDY_MISMATCH 409; EXPORT_PATIENTS_REQUIRED/CRITERIA_TOO_SHORT/REASON_TOO_SHORT 400; STUDY/COHORT/EXPORT/PATIENT_NOT_FOUND 404; PATIENT_FACILITY_MISMATCH 409.
- [x] Tests: unit (5 tests: study/cohort/export state machines, guard cascade, stable pseudonyms), integration live PG (2 tests: full approval chain + denial path + revocation + vault + outbox 9-event chain + DB pseudonym-uniqueness backstop), e2e DB-less (4 × 403/400 above sentinel).

## Non-goals

- Cohort *execution* engine (criteria jsonb is a governed artifact; running queries against the warehouse is EPIC-20 territory), patient-facing trial consent (consent module owns decisions; study enrollment consent is a later integration), IRB document storage (documents module), re-identification workflow (vault listing is privileged; the release process is policy), analytics dashboards (EPIC-20).

## Decisions

- **D1** — Studies are the governance anchor: facility-scoped, unique code, draft→approved→closed with approver provenance (IAM-001 approved purpose of use). Nothing else (cohorts, exports) can progress without an approved study.
- **D2** — Cohort definitions are immutable versions: editing a query creates version+1 (UNIQUE study+name+version); the governed artifact is stored as jsonb criteria (ANAT-001 §38 governed dataset basis) but is NOT executed here — this module governs the process, not the warehouse (EPIC-20 boundary).
- **D3** — Export controls are a state machine with human decisions at every step: requested→(approved|denied)→exported→revoked, decision maker + note recorded (provenance); the requested patient list is snapshotted on the export row at request time.
- **D4** — De-identification is real: generation creates per-study pseudonyms in the `res.subject_link` vault (UNIQUE study+patient and study+pseudonym at the DB level); pseudonyms are STABLE across re-exports of the same patient (proven in integration); revocation never deletes vault rows (audit/provenance preserved — revocation is an export-control state, not a data wipe).
- **D5** — Patients are validated at request time: must exist and match the study's facility (PATIENT_FACILITY_MISMATCH) — IAM-001 research access uses approved data scope.
- **D6** — The vault listing endpoint requires `research:manage` (not read): re-identification capability is the most sensitive surface in the module.

## Evidence (live proof, container `pulse-pg-s38`)

| Gate | Result |
|---|---|
| Migration | `0001`→`0033` applied on fresh DB |
| Integration (live PG) | **77/77 across 34 files**, 2nd consecutive run on same DB (idempotent); `research.integration-spec.ts` 2/2 (approval chain, denial path, revocation, vault stability, 9 outbox event types, DB pseudonym backstop) |
| Unit | **270/270** across 56 files (research: 5) |
| e2e | **105/105** (+4 research 403/400 above sentinel) |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 325 files; boundaries 229; secrets clean) |
| Build | `pnpm build` 9/9 |

## Follow-ons

- **EPIC-25 is complete.** Remaining backlog epics per `BACKLOG_TRACKER.md` (next in order: research/analytics follow-ons under EPIC-20 if prioritized, otherwise the next unfinished epic in sequence).
- Cohort execution engine + research-safe data marts (EPIC-20); study-enrollment consent integration (consent module); IRB document linkage (documents module); re-identification release workflow (policy + audit surface); warehouse export pipeline consuming `res.export_generated` events.
