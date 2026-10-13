# Sprint 18 — Pilot Readiness II: Security Pass + Onboarding Seed

Goal: prove the platform is safe to pilot — no secrets in source, every route guarded, break-glass governed, and a one-command demo facility seed with an onboarding checklist.
Status: Done (closed 2026-10-11)
Specs: SEC-001, IAM-001 (break-glass), ONB-001, EPIC-22/24 (partial)

## Scope

- [ ] `scripts/check-secrets.mjs` (pattern scan over source, allowlisted fixtures) wired as `pnpm secrets` + documented CI step
- [ ] Authz coverage gate: static test asserting every controller except an explicit public allowlist carries auth guards
- [ ] Break-glass enforcement: reason required (≥10 chars) when header present, else 400; flag + reason flow to audit via request context
- [ ] `infra/seeds/demo-facility.sql` (idempotent: City General–style org/facility/departments, lab tests, meds, services, tariff, demo payer) + `docs/runbooks/onboarding.md`
- [ ] Dependency audit recorded (`pnpm audit`); fix or waive with reason
- [ ] Tests: unit (break-glass validation, coverage gate), e2e (break-glass paths), live-DB (seed applies twice cleanly)

## Non-goals

- Full pentest, SIEM, data-center HA, STAFF password auth (still F03.1 stub).

## Evidence (live-DB proof 2026-10-11)

- `pnpm secrets` clean (one true positive fixed: usage-comment credential shape in `db-migrate.mjs` rewritten password-free)
- Authz gate green: every non-public controller carries a guard; public allowlist = app/health/metrics (+fhir mixed, method-guarded)
- Break-glass: throwaway reasons 403, real justifications pass and flow into audit metadata
- Seed twice-safe live (second run all `INSERT 0 0`; CGH + 4 tariff lines verified); `test:int` 25/25, unit 85/85 (2 load flakes re-passed in isolation), e2e 37/37, build 9/9 (incl. Next 14.2.35), lint 0/0 (183 files), boundaries ok (139 files)
- Audit: 39 → 27 findings via Next 14.2.35 patch; remaining 2 critical + 10 high need Next ≥15.5.24 (major, React 19) — waived: shell is non-production with no image-optimization/Windows exposure; API surface (NestJS) has zero findings
- Verify container removed; runbooks: `docs/runbooks/onboarding.md`

## Pending

- None. Sprint 18 closed. Remaining: EPIC-21 edge/offline, EPIC-24 remainder, R6 specialties, Phase-2 insurance, Next 15 migration.
