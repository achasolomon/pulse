# Sprint 03 — Org Registry + Membership Persistence (real DB)

Goal: prove the persistence chain against real Postgres — migrations apply in order, org/facility writes are scoped, membership resolves from DB.
Status: Done (closed 2026-10-07)
Streams: A Persistence (migrations + repos) / B Domain (org controller + guard wiring)

## Scope

- [ ] Infra: `postgres` up via compose, 0001 applied for real, evidence recorded
- [ ] Migration `0002_org_iam.sql`: `org.organization`, `org.facility`, `org.department`, `iam.membership` (+ unique/indexes, no destructive DDL)
- [ ] `modules/organization/`: domain types, repository port, Kysely repo, service (create org/facility, list facilities), controller (`POST /organizations`, `POST /facilities`, `GET /facilities`) guarded + audited + outbox on create
- [ ] IAM: `MembershipRepository` (Kysely) + `MembershipService`; `AuthorizationGuard` prefers DB membership, falls back to demo header when no DB (tests stay green)
- [ ] Integration tests `*.integration-spec.ts` (run only with `DATABASE_URL`, otherwise skip): migrate + org create/list + membership resolve + outbox row exists + audit row exists
- [ ] `pnpm --filter api test:int` script; default `test`/`test:e2e` stay DB-less and green

## Demo script

1. `docker compose -f infra/docker-compose.yml up -d postgres` → healthy
2. `DATABASE_URL=... pnpm db:migrate` → 0001 + 0002 applied, recorded in `schema_migrations`
3. `test:int` green against real DB; `test` + `test:e2e` green without DB

## Evidence (live-DB proof 2026-10-07)

- Postgres 16 via docker on host 5433 (host 5432 occupied by unrelated PID 24988): `db-migrate` applied `0001` + `0002` for real, re-run idempotent (both skip via `schema_migrations`)
- `test:int` 2/2 green vs live DB: org→facility→list→outbox rows present; membership create→resolve with `patient:read`
- Regression: `pnpm build` 8/8, unit 9/9, e2e 8/8, oxlint 0/0 (46 files), boundaries ok (35 files)
- Fixes in-session: `OrganizationModule`→`IamModule` DI import; DTO spread lint; Kysely `Generated`/`ColumnType` insert types; `pg` hoisted to workspace root for `scripts/` resolution; lazy `pg` import keeps `--dry-run` root-runnable
- Verify container removed after proof; committed compose stays canonical on 5432 — use `DATABASE_URL` override when host 5432 is taken

## Pending

- None. Sprint 03 closed.

## Safety/privacy notes

- Org/facility names are operational, not PHI; still minimum-necessary in audit metadata.
- Membership privileges are authoritative — demo header is dev-only fallback, never in production profile.
