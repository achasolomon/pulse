# ADR-001 — Modular Monolith First

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-ARCH-001 §3, PULSE-ENG-001 §2, PULSE-BE-001 §3

## Decision

Start as a domain-modular NestJS monolith in `apps/api`. Each healthcare domain is an explicit Nest module under `src/modules/<domain>/` with owned application/domain/infrastructure/interface code. Cross-domain collaboration only via published application contracts or domain events — never direct repository imports.

Separately deployable services are allowed only where the trust boundary or workload already justifies it: `integration-gateway` (FHIR/HL7), `worker` (async jobs), `edge` (offline).

## Extraction triggers (all require measured evidence)

- Independent scaling pressure, different SLA, external trust boundary, dedicated team cadence, unsuitable runtime, blast-radius reduction.

## Consequences

- Enforce with boundary lint. Logical ownership holds even when sharing one physical Postgres cluster.
- Related: ADR-004 (outbox), ADR-005 (FHIR at gateway).
