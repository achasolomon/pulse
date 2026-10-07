# ADR-005 — FHIR and Interop Terminate at Gateway

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-FHIR-001 §2–§3, PULSE-ARCH-001 §11, PULSE-ENG-001 §31–§33

## Decision

Internal domain models stay domain-native and optimized for transactional safety. All FHIR (R4 primary), HL7v2, and DICOM translation happens in a dedicated integration boundary (`apps/integration-gateway`, deferred to R4). The core API (`/api/v1`) never exposes FHIR resource shapes directly.

## Rules

- Stable opaque resource IDs; business IDs stay in `Identifier` elements with explicit system URIs.
- Profile validation before accepting external clinical content; idempotent ingestion; versioned mappings; quarantine on mapping failure.
- DICOM pixels never enter transactional Postgres.
