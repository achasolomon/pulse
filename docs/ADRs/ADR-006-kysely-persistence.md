# ADR-006 — Kysely + Plain-SQL Migrations for Persistence

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-DB-001 §92–§96, PULSE-BE-001 §17–§19, ADR-002, ADR-004

## Decision

Use **Kysely** (type-safe SQL builder) with **plain-SQL, reviewed, expand/contract migrations** in `infra/migrations/`. No ORM code-first auto-generation for clinical tables.

## Rationale

- Clinical ledgers, partitioning, partial/covering indexes, RLS policies, and outbox atomicity need explicit reviewable SQL. Prisma/TypeORM hide too much and complicate expand/contract discipline.
- Kysely gives end-to-end typing from explicit table interfaces without concealing SQL. Repositories stay behind domain ports (BE-001 §16): `XxxRepository` interface in application layer, Kysely implementation in `modules/<domain>/infrastructure/`.
- `pg` driver only. Connection pooling via `pg.Pool` (later PgBouncer per DB-001 §64).

## Conventions

- One migration = one transaction where DDL allows; `IF NOT EXISTS` guards; every migration has a forward fix, never silent repair.
- Filenames: `NNNN_description.sql` (e.g. `0001_platform_outbox_inbox_audit.sql`).
- UUID PKs (`gen_random_uuid()`), `created_at timestamptz NOT NULL DEFAULT now()`, UTC storage + clinical effective time columns per domain, no hard-delete on signed/ledger/audit tables (enforced by app + `BEFORE DELETE` trigger where safety-critical).
- Outbox relay (Sprint 02) reads `integration.outbox WHERE published_at IS NULL FOR UPDATE SKIP LOCKED`.

## Alternatives considered

- Prisma: best DX/migration review, but RLS/partition/ledger ergonomics weaker, raw-SQL escape hatches frequent.
- TypeORM: native NestJS fit, but noisy auto-migrations and weak typing rejected for safety-critical tables.
- Drizzle: close second; Kysely chosen for thinner abstraction over SQL and smaller surface.

## Consequences

- Sprint 01: `infra/migrations/0001_platform_outbox_inbox_audit.sql` lands (schemas + outbox/inbox/audit_event).
- Sprint 02: `DatabaseModule` (Kysely `PostgresDialect`) + repository example + relay skeleton + `scripts/db-migrate.mjs` runner.
