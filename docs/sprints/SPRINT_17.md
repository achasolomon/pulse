# Sprint 17 — R5 Hardening: Observability, Security, Operability

Goal: pilot-readiness evidence — honest readiness, request metrics, abuse protection on auth surfaces, reproducible container, backup/restore drill path, written SLOs.
Status: Done (closed 2026-10-08)
Specs: OPS-001, NFR-001 (SLOs), SEC-001 (abuse controls), PULSE-BE-001 §101–104

## Scope

- [ ] Readiness with real DB check (`/health/ready` reports `db: up|down|not-configured`; app stays servable detail-first)
- [ ] `GET /metrics` Prometheus-text request counters + latency buckets (in-memory, low cardinality, no PHI/labels)
- [ ] Abuse protection: `@nestjs/throttler` — strict on portal login + partner-key surface, generous default elsewhere
- [ ] Security headers e2e (helmet already on): assert `x-content-type-options`, `x-frame-options`, no `x-powered-by`
- [ ] Container: multi-stage `apps/api/Dockerfile` + `.dockerignore`, reproducible `docker build` proof
- [ ] `scripts/db-backup.mjs` (pg_dump wrapper + verification query) + `docs/runbooks/backup-restore.md` + `docs/runbooks/incident.md` + `docs/SLO.md`
- [ ] Tests: unit (metrics registry pure), e2e (429 burst on login, headers, ready shape), live-DB (ready reports `up`, metrics increment)

## Non-goals

- Edge/offline sync (EPIC-21), full SIEM/log shipping, PgBouncer/HA topology (R5 later sprints).

## Evidence (live proof 2026-10-08)

- `test:int` 26/26 incl. `ops.integration-spec.ts` (`ready` → `db: up` live); unit 83/83; e2e 35/35 (headers, metrics shape, 429 burst); oxlint 0/0; boundaries ok (138 files); `pnpm build` 9/9
- Container `pulse-api:sprint17` (955MB) built from `apps/api/Dockerfile` and smoke-tested live: `/health/live` ok, `/health/ready` `db: not-configured` (no DATABASE_URL, correct), `/metrics` recording handler traffic
- Findings fixed in-session: repo-root `.dockerignore` (context 535MB → 90kB); pnpm 11 requires Node ≥22 → image on `node:22-alpine`; runner mirrors workspace layout for pnpm symlinked `node_modules`; single shared `configureApp()` for prod + tests (e2e now verifies real helmet/pipes/filters)
- Docs: `docs/runbooks/backup-restore.md`, `docs/runbooks/incident.md`, `docs/SLO.md`; `scripts/db-backup.mjs`
- Follow-ups recorded (not blockers): slim runner with prod-only deps (~300MB est.); Redis throttler storage for multi-instance; registry mirror for flaky networks; pg_dump restore drill at pilot cutover

## Pending

- None. Sprint 17 closed. Next: R5 remainder (edge/offline EPIC-21, onboarding EPIC-24) or R6 specialties.
