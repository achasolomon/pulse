# ADR-004 — Transactional Outbox + At-Least-Once Events

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-EVT-001 §7, PULSE-ARCH-001 §8–§9, PULSE-ENG-001 §18

## Decision

- Domain state + `outbox` row commit in the same local DB transaction. A relay publishes to the broker; consumers are idempotent via `inbox` / idempotency keys.
- Critical writes are synchronous and durable; indexing, notifications, analytics, and cross-domain reactions are async.
- Event = past-tense immutable fact with `eventId/type/version/occurredAt/producer/aggregateId/correlationId`. Minimum necessary PHI. Versioned schemas in `packages/events`.
- Never use the event bus to avoid a required transaction.

## Sprint 01 scope

Tables `outbox` + `inbox` defined in migration plan; relay implementation deferred to Sprint 02 with ORM choice. `packages/events` envelope types land now.
