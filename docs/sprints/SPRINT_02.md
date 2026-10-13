# Sprint 02 — Tenant Context, Audit, Outbox Relay, IAM Skeleton

Goal: every clinical write carries tenant/facility/correlation context, is auditable, and emits a durable outbox event. Default-deny IAM skeleton.
Status: Done (closed 2026-10-07)
Streams: A Platform (context/audit/outbox) / B IAM + example domain wiring

## Scope

- [ ] F02.3 Facility context selection + scoping guard (headers → AsyncLocalStorage → `@RequireContext()` guard, 403 ProblemDetails)
- [ ] Audit interceptor + `AuditService` (Kysely insert, fail-open with warn when no DB, covered by unit test with mock)
- [ ] Outbox service (`OutboxService.publish`) + relay skeleton (`OutboxRelay` polls `SKIP LOCKED`, marks published) + repository example
- [ ] `scripts/db-migrate.mjs` runner (applies `infra/migrations/*.sql` in order, records in `integration.schema_migrations`)
- [ ] F03.1–F03.4 IAM skeleton: `modules/iam/` domain types (membership/role/privilege), `AccessPolicy` default-deny engine, `AuthorizationGuard` stub, break-glass decorator + header contract
- [ ] Boundary + e2e: cross-facility denied, missing context denied, audit/outbox code paths unit-tested without DB

## Demo script

1. `node scripts/db-migrate.mjs --dry-run` lists 0001; with `DATABASE_URL` applies + records
2. `GET /api/v1/health/live` with `x-tenant-id`/`x-facility-id` echoes correlation; protected stub without headers → 403 ProblemDetails
3. Unit: policy denies cross-facility by default; audit/outbox services called with envelope

## Evidence

- `pnpm build` 8/8 (api + web-clinical + 6 packages)
- api `tsc --noEmit` exit 0; `oxlint --type-aware` 0/0 (34 files); boundaries ok (25 files)
- unit 7/7 (policy 3, platform-services 3, app 1); e2e 8/8 (secure/ping 403-no-context, 403-no-privilege, 200-with-privilege)
- `node scripts/db-migrate.mjs --dry-run` lists 0001; `scripts/check-boundaries.mjs` wired to turbo
- Modules: `AuditModule` (fail-open), `OutboxModule` (publish + SKIP LOCKED relay skeleton), `IamModule` (default-deny), `SecureExampleController` demo chain

## Safety/privacy notes

- No PHI in audit metadata in Sprint 02 — resource ids only.
- Break-glass not yet enforced end-to-end; contract only (reason header + audit flag). Full enforcement Sprint 03 with EPIC-04.
