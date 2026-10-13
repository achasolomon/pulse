# Sprint 12 — FHIR Read Gateway (R4 interop start)

Goal: standards-aligned read access to Pulse data without exposing internal models — CapabilityStatement, partner API keys, Patient/Encounter/Observation FHIR reads with translation isolated for later extraction.
Status: Done (closed 2026-10-08)
Specs: FHIR-001 (R4 profiles, CapabilityStatement, identifier namespaces), API-001 (partner surface), ARCH-001 §11, ADR-005

## Scope

- [x] EPIC-18 (partial): `integration.partner` registry (key hash + scopes + active), `x-api-key` guard (constant-time compare, 401 ProblemDetails), FHIR access audit
- [x] `GET /fhir/v1/metadata` CapabilityStatement (declared R4, profiles, interactions)
- [x] `GET /fhir/v1/Patient/:id` + `GET /fhir/v1/Patient?identifier=` (opaque IDs = domain UUIDs; MRNs as `identifier[]` with `urn:pulse:mrn:*` systems)
- [x] `GET /fhir/v1/Observation?patient=` (our `clin.observation` rows as FHIR Observations) + `GET /fhir/v1/Encounter/:id`
- [x] Translation layer in `modules/fhir/` only — zero imports of domain infrastructure; reads via repository ports
- [x] Tests: unit (translation pure incl. gender map + unknown-code passthrough), integration live PG (seed → FHIR search finds), e2e DB-less (401/404)

## Non-goals

- FHIR writes, HL7v2/DICOM adapters, SMART auth, process split to `apps/integration-gateway` (all land when scale/ownership demands; boundary is already extractable).

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0011` for real
- `test:int` 19/19 green incl. `fhir.integration-spec.ts`: FHIR Patient read (namespaced MRN, male), identifier search, Observation search, partner-attributed `fhir_log`
- Regression: build 9/9, unit 59/59, e2e 26/26 (new: metadata R4 + 401), oxlint 0/0 (147 files), boundaries ok (116 files)
- Fixes: e2e file premature-close merge; partner UUID attribution in tests. Verify container removed.

## Pending

- None. Sprint 12 closed. Next: patient portal read models (EPIC-19) or R5 hardening (EPIC-21/22/23/24).
