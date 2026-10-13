# Sprint 28 — Anatomical Mapping Engine backend core (ANAT)

Goal: land the backend core of the Anatomical Clinical Mapping Engine (ACME) per ANAT-001 — versioned anatomy model/structure catalogue with terminology mappings, and the attributed AnatomyFinding lifecycle (draft → sign → amend → enter-in-error) with laterality safety, geometry capture, clinical links, and outbox events. Status: Done

Specs: ANAT-001 §4 (core objects), §9 (finding canonical record), §24–§26 (API + events), §28 (persistence), §29–§30 (tenancy, access control), §44 (Release-1 minimum acceptance, backend subset)

## Scope

- [x] Migration `0024_anatomy.sql`: schema `anat` — `anatomy_model` (versioned, immutable published versions), `anatomy_structure` (hierarchy with parent self-FK + level), `structure_mapping` (terminology), `finding` (patient/encounter/facility-scoped, laterality, status machine, geometry JSONB, amendment/error provenance, optimistic `version`, idempotent `client_ref`), `finding_link` (clinical relations); additive indexes only.
- [x] Domain: types + pure finding action guards (`update`/`sign`/`amend`/`enterError`) + repository port (`anatomy.repository.ts`).
- [x] Kysely repository: model/structure/mapping CRUD, finding lifecycle (version-checked draft update, transactional amend, status transitions), patient-encounter consistency check, target-patient resolution for links.
- [x] Service + guarded controller (`TenantContextGuard` + `AuthorizationGuard`, audited writes): model catalogue (create/list/get), structure create/list/get, mapping create, finding create/list/get/update/sign/amend/enter-error/link. Outbox events `anatomy.model_created`, `anatomy.mapping_updated`, `anatomy.finding_drafted|signed|amended|entered_in_error|linked`.
- [x] DTOs with strict validators (laterality/severity/level enums, UUIDs, geometry object array, `expectedVersion` integer, `clientRef` idempotency key).
- [x] `db.types.ts`: five `anat.*` row types + `PulseDatabase` registration.
- [x] Tests: unit (15: pure guards + service with fake repo), e2e (6: context-required/privilege/400, no DB), integration live PG (2: full lifecycle + events + links; safety rejections).
- [x] Registered in `apps/api/src/app.module.ts`.

## Non-goals

- 3D renderer, model asset packaging/CDN, viewer UI (ANAT-0 spike), specialty view presets (§14), snapshots/media/measurements (ANAT-3), FHIR export of findings (EPIC-18), offline asset packages (ANAT-5), model retire/withdraw governance endpoints (create-time status only), procedure links (no procedure table yet — lands with surgical episode slice).

## Decisions

- **Laterality is required at sign time** (may be `not_applicable`/`unknown`, never `null`): pure guard `assertFindingAction` enforces it, service maps to 400 `ANAT_LATERALITY_REQUIRED`. Safety rule: laterality is semantic, never derived from camera/screen side.
- **Status machine**: `draft → signed → amended | entered_in_error`; `draft → entered_in_error` allowed (wrong-patient corrections); `amended` and `entered_in_error` are terminal (no destructive delete ever — ANAT-001 §25).
- **Amend is transactional**: prior `signed` row flips to `amended` and a new `draft` row with `amends_id` + `amendment_reason` is inserted in one transaction; the `anatomy.finding_amended` event aggregates on the **prior** finding id (payload carries `newId` + `priorId`), so timeline consumers can follow the chain from the original record.
- **Optimistic concurrency only on draft update** (`expectedVersion` required, 409 `FINDING_VERSION_CONFLICT`); status transitions are guarded by the state machine instead. `version` increments only on draft edits.
- **Idempotent draft creation** via `client_ref` (unique per facility, partial index); repeat create with the same ref returns the existing finding.
- **New annotations require an `active` model** (retired/draft/validation models are read-only for history) — 422 `MODEL_NOT_ACTIVE`; structures must belong to the selected model and be active.
- **Finding link targets** map to existing patient-bearing tables: `condition → clin.entry`, `observation → clin.observation`, `note → clin.note`, `document → docs.document`, `encounter → encounter.encounter`. Link validates target existence (400) and same-patient match (400); duplicate links are idempotent.
- **Findings are facility-scoped on create/list** (facility from tenant context, never from body); single-record reads are privilege-checked like the rest of the codebase (no per-facility UUID deny — policy engine already narrows membership by facility).
- **Privileges**: `anatomy_catalog:manage/read` (catalogue), `terminology:manage` (mappings), `anatomy:document/sign/amend/read` (findings) — demo-header strings for e2e.
- **Geometry is JSONB** (array of point/area/path objects) per §28; semantics stay relational/queryable.

## Evidence (live PG `pulse-pg-s28`, migrations 0001–0024, fresh DB)

- Unit: 163/163 (`vitest run`), incl. 15 new anatomy tests (4 pure-guard + 11 service/fake-repo).
- E2e: 64/64 (`vitest.config.e2e.ts`, no DB), incl. 6 new anatomy tests (context-required ×2, privilege-denied, 400 body ×2, missing patientId).
- Integration live: 47/47 (`vitest.config.int.ts`, `pulse-pg-s28` on 5433), incl. 2 new tests in `anatomy.integration-spec.ts` (catalogue hierarchy + mapping, draft→update→sign→amend→enter-error with outbox facts, clientRef idempotency, encounter link; laterality/non-active-model/cross-patient encounter+link rejections).
- Gates: `tsc --noEmit` 0; `oxlint --type-aware` 0 warnings / 0 errors (242 files); `check-boundaries` ok (179 files); `check-secrets` clean; `pnpm build` 9/9.
- Teardown: `docker rm -f pulse-pg-s28`; `apps/api/tsconfig.build.tsbuildinfo` restored.
