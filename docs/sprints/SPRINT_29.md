# Sprint 29 — FHIR writes / adapters (EPIC-18)

**Status:** done
**Goal:** Close EPIC-18 with an approved write surface: partner-key-scoped FHIR
`create` for the Release-1 accepting set (Condition, AllergyIntolerance,
Observation) plus a legacy HL7v2 ORU^R01 adapter, both with explicit
idempotency, source provenance, and reconciliation-safe origin marking
(FHIR-001 §47, §50, §62–§65, §80 FHIR-SR-003/005/006/007/011/013/015, API-001 §25).

## Scope

### In

1. **FHIR create endpoints** (partner-key surface, write scope required):
   - `POST /fhir/v1/Condition` → `clin.entry` (kind `problem`)
   - `POST /fhir/v1/AllergyIntolerance` → `clin.entry` (kind `allergy`)
   - `POST /fhir/v1/Observation` → `clin.observation`
   - `POST /fhir/v1/hl7v2/oru` → `clin.observation` per OBX (legacy adapter,
     §65: explicit AA/AE ACK, message control id idempotency)
2. **Idempotency** (§50, API-001 §25): optional `idempotency-key` header,
   scoped `(partner_id, resource_type, idempotency_key)`; same key + same
   payload → 200 replay of prior outcome (`x-idempotent-replay: true`);
   same key + different payload → 409 conflict. Race-safe via unique
   constraint (claim-first, compensate on domain failure).
3. **Provenance / origin** (FHIR-SR-003): new `integration.external_resource`
   row per accepted create (partner, fingerprint, outcome, method
   `fhir|hl7v2-oru`); `clin.entry.origin` / `clin.observation.origin`
   columns (`local` default, `external` for imports). Imported content is
   never signed/promoted — origin stays `external` (§63 source authority).
4. **Identity resolution** (§62): FHIR `subject.reference = Patient/<uuid>`;
   HL7v2 PID-3 → exact `patient.identifier` value match. 0 matches → 404;
   >1 matches → 409 `PATIENT_IDENTITY_AMBIGUOUS` (governed matching later).
   Optional `context.encounter.reference` must exist and belong to the
   patient (400 on mismatch).
5. **Scope enforcement**: `PartnerApiKeyGuard` now attaches partner scopes
   (dev fallback `['read','write']`); new `PartnerWriteScopeGuard` requires
   `write` on all write endpoints (403 `PARTNER_SCOPE_DENIED`). Reads keep
   current behavior (no scope check this sprint — FHIR-SR-014 read-scope
   enforcement deferred).
6. **Errors**: OperationOutcome pass-through added to `HttpProblemFilter`
   (§54/T-501: FHIR error responses are OperationOutcome; all non-FHIR
   surfaces keep ProblemDetails).
7. **CapabilityStatement** updated with the three `create` interactions
   (§6 accuracy requirement).
8. **Read-back provenance**: `GET /fhir/v1/Observation?patient=` adds
   `meta.source = 'urn:pulse:origin:external'` for externally imported rows
   (§82 provenance survives mapping in and back out).

### Out (explicit non-goals)

- Patient identifier matching/merging by demographics (§10 governed
  matching) — exact stable-identifier match only.
- Conditional create (`If-None-Exist`), transaction/batch bundles,
  `update`/`patch`/`delete` (§47: corrections via future workflow, never
  delete).
- Patient/Organization/Practitioner create; lab/imaging/medication writes.
- HL7v2 ADT/ORM messages, MLLP transport, v2 ACK over TCP.
- Read-scope enforcement on partner reads, SMART scopes (FHIR-SR-014 full).
- Subscriptions, bulk export, `$everything`.

## Design decisions (recorded at close)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Claim-first idempotency: provenance row inserted (unique key) **before** domain row; domain insert uses explicit id; compensate by deleting claim on domain failure | No duplicate clinical rows on race; no orphan provenance |
| D2 | HL7v2 message → one provenance row + one observation per OBX, key = `<controlId>:<setId>` | Per-segment idempotent replay; whole message validated before any insert (no partial ACK) |
| D3 | `origin` column on domain rows (additive, default `local`) not provenance-only | Reconciliation queries + read-back provenance need it on the row itself |
| D4 | OperationOutcome pass-through in shared filter keyed on `resourceType` | §54 mandates OperationOutcome on FHIR surface; non-FHIR surfaces unchanged |
| D5 | Unknown codes stored verbatim (`code` free text), never remapped | FHIR-SR-005 / §65 "quarantined/mapped, not guessed" |
| D6 | Scope check is a separate guard after partner key; dev fallback grants `['read','write']` | Reads unaffected; 403 testable in e2e without DB |

## Files

- `infra/migrations/0025_fhir_writes.sql` — origin columns + `integration.external_resource`
- `apps/api/src/modules/fhir/domain/from-fhir.ts` (+ spec) — inbound parsers, fingerprint
- `apps/api/src/modules/fhir/domain/hl7v2.ts` (+ spec) — ORU^R01 parser, ACK builder
- `apps/api/src/modules/fhir/domain/translate.ts` — + `toFhirCondition`, `toFhirAllergyIntolerance`, capability create interactions
- `apps/api/src/modules/fhir/application/external-import.service.ts` (+ spec)
- `apps/api/src/modules/fhir/infrastructure/external-resource.repository.ts`
- `apps/api/src/modules/fhir/interface/{partner-write-scope.guard.ts, fhir.controller.ts, partner-key.guard.ts}`
- `apps/api/src/modules/patient/domain|infrastructure/*` — `findByIdentifierValue`
- `apps/api/src/modules/clinical/*` — optional `id` + `origin` on recordEntry/recordObservation
- `apps/api/src/platform/common/filters/http-problem.filter.ts` — OperationOutcome pass-through
- `apps/api/test/{platform.e2e-spec.ts, fhir-writes.integration-spec.ts}`

## Evidence

Live proof on fresh `pulse-pg-s29` (postgres:16-alpine, :5433), migrations
0001–0025 applied (`0025_fhir_writes.sql` last), then the integration suite:

| Gate | Result |
|------|--------|
| `node scripts/db-migrate.mjs` | 25/25 applied (0001–0025) |
| `vitest run --config vitest.config.int.ts` (live) | **54/54** (25 files; +7 in `fhir-writes.integration-spec.ts`) |
| `pnpm --filter api test` (unit) | **193/193** (37 files; +30 tests across 5 new/updated spec files) |
| `pnpm --filter api test:e2e` | **71/71** (2 files; +7 above sentinel) |
| `tsc --noEmit -p tsconfig.json` | 0 errors |
| `oxlint --type-aware src/ test/` | 0 warnings / 0 errors (252 files) |
| `node scripts/check-boundaries.mjs` | ok (184 files) |
| `node scripts/check-secrets.mjs` | clean |
| `pnpm build` | 9/9 tasks |

Live integration assertions covered: Condition create with `origin='external'`,
ledger provenance (`method='fhir'`, `outcome='created'`), fhir_log 201,
`integration.external_imported` outbox event; idempotent replay (same id, one
ledger row, 200 log) and 409 `IDEMPOTENCY_CONFLICT`; 404 `PATIENT_NOT_FOUND`;
HL7v2 ORU → 2 observations + `MSA|AA` ACK + per-OBX ledger keys + full-message
replay; 404 unknown / 409 ambiguous identifier; Observation
`effectiveDateTime` honored; read-back `meta.source='urn:pulse:origin:external'`
on external rows and absent on local rows; 404 unknown encounter.

Teardown: `docker rm -f pulse-pg-s29`; `apps/api/tsconfig.build.tsbuildinfo`
restored. **EPIC-18 closed — the EPIC-18 row flips to Done in
`docs/BACKLOG_TRACKER.md`.**
