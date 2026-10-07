# Sprint 01 — R0 Foundation Boot (F01.1–F01.4 skeleton)

Goal: make the system buildable, testable, and ready for domain work. No clinical features.
Status: Done (closed 2026-10-07)
Streams: A Platform / B Shell

## Scope

- [ ] F01.1 Repository & workspace foundation — verify pnpm/turbo, add `packages/*` READMEs, boundary rules
- [ ] F01.2 Local dev infra — `infra/docker-compose.yml` (Postgres 16, Redis, MinIO, Mailhog), migration runner decision (ADR-004)
- [ ] F01.3 CI quality pipeline — type-aware lint, boundary-lint, test (vitest), container build passes on clean checkout
- [ ] F01.4 Backend platform primitives — fill `platform/config`, validation pipe, exception filter (API-001 error model), request-context, `/api/v1`, health/readiness, correlation logging
- [ ] F01.5 (start) Design tokens — `packages/ui` palette + fonts from `brand/` (Deep Teal #075E54, Clinical Teal #0B7A6B, neutrals, semantic colours)
- [ ] ADRs 001–005 drafted

## Demo script

1. Fresh clone → `pnpm install && pnpm build && pnpm test` green
2. `docker compose up` → API `/api/v1/health` + `/api/v1/ready` 200
3. Bad payload → consistent problem-details error; cross-facility stub denied; correlation ID in logs without PHI

## Evidence

- `pnpm build` (turbo): 7 successful — api + 6 packages
- `oxlint --type-aware src/ test/`: 0 warnings, 0 errors
- `vitest run`: 1/1 unit pass; `vitest --config e2e`: 5/5 (hello, health/live+ready, ProblemDetails 404, correlation header)
- ADRs: `docs/ADRs/ADR-001` to `ADR-005`
- Infra: `infra/docker-compose.yml` (pg16/redis/minio/mailhog) + README + .env.example
- Contracts: `packages/api-contracts` ProblemDetails/Paginated, `packages/events` DomainEvent envelope, `packages/ui` pulseTokens
- API: global `/api/v1` prefix, helmet, ValidationPipe (whitelist), HttpProblemFilter, CorrelationMiddleware, HealthModule, DatabaseModule (Kysely lazy pool, no queries at boot)
- Boundaries: `scripts/check-boundaries.mjs` + `CODEOWNERS` + `turbo boundaries` / `pnpm --filter api boundaries`; positive ok (9 files), negative fixture correctly failed exit 1 then removed
- ORM: ADR-006 Kysely + `infra/migrations/0001_platform_outbox_inbox_audit.sql` (integration.outbox/inbox, audit.audit_event); `kysely` + `pg` (+ `@types/pg`) added to api; relay + repositories + migrate runner → Sprint 02
- Web: `apps/web-clinical` (Next 14, React 18) static shell — sidebar 14 items, facility placeholder, patient-banner empty state, KPI stubs; `next build` 4/4 static, typecheck exit 0, oxlint 0/0
- Full verification: `pnpm build` 8/8, api lint 0/0, unit 1/1, e2e 5/5

## Carry-over to Sprint 02 (EPIC-02/03 + outbox relay)

- `scripts/db-migrate.mjs` runner + `DATABASE_URL` wiring in CI
- Outbox relay skeleton + repository example (`modules/<domain>/infrastructure`)
- Tenant/facility guard + audit interceptor + IAM skeleton (F03.x)

## Carry-over / risks

- ORM choice must be locked in ADR before F01.2 migration code (per BE-001 §17–§19).
- Do not start EPIC-02/03 domain tables until outbox + audit interceptor merged.

## Safety/privacy notes

- No PHI in seed; no secrets in repo; break-glass and authz engine deferred to Sprint 02 (F03.x) — auth skeleton only.
