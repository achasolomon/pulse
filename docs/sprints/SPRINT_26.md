# Sprint 26 — Contextual Authorization (F03.4) + Break-Glass Enforcement (F03.5)

Goal: access decisions that consider department, purpose, and care relationship — and break-glass that is recorded, time-limited, scoped to clinical resources, and reviewable (IAM-001 §17/§18/§31).
Status: Done
Specs: IAM-001 §17 (attribute-based access), §18 (care relationship), §31 (break-glass), Appendix A/C

## Scope

- [x] Migration `0022_contextual_authz.sql`: `iam.membership.department_id` (additive), `iam.care_assignment` (patient ↔ person ↔ facility assignment, IAM consumes clinical context), `iam.break_glass_grant` (reason, scope, TTL, review status)
- [x] Policy engine v2 (`policy.ts`): facility match → department match → purpose validation → privilege → care-relationship narrowing for patient-scoped chart access; break-glass as last-resort ALLOW with reason codes (ALLOW/DENY/… per §17)
- [x] Care-relationship narrowing: when a request carries an explicit patient scope (`x-patient-id`) and targets a chart resource, require an active `iam.care_assignment` or the explicit `care:unrestricted` privilege; knowing a name is not access (§18 ACCESS CONTROL RULE)
- [x] Break-glass enforcement (§31): real reason required (length + throwaway denylist), eligibility limited to clinical patient-data resources (never financial/admin/config), 30-minute TTL grants in `iam.break_glass_grant`, `BreakGlassActivated`/`BreakGlassExpired` outbox events, repeat-use abuse threshold (3/24h → deny), passive expiry
- [x] Header contract: `x-patient-id`, `x-department-id`, `x-purpose` (treatment|payment|operations|audit|research) captured by TenantContextGuard; invalid UUID/purpose rejected up front
- [x] Tests: unit (policy matrix, reason quality, eligibility, abuse), integration live PG (care-assignment round-trip + narrowing, grant create/count/expiry/abuse), e2e (break-glass expands missing clinical privilege, ineligible financial resource stays denied, invalid patient-id/purpose rejected)

## Non-goals

- Step-up MFA on break-glass, notification fan-out, review workflow UI, delegation/act-as (§32/§33), FHIR partner policies.

## Decisions

- Narrowing engages only when the request carries an explicit patient scope — registration, search, and non-patient endpoints keep today's privilege-only contract, so the whole existing suite stays green.
- IAM owns `iam.care_assignment` as the assignment registry clinical domains will write through their own services; the policy consumes it via a port (IAM remains decider, clinical remains owner of truth).
- Break-glass expands exactly the requested `resourceType:action` for one facility (+ patient when scoped), never `revenue:*`/`org:*`/`iam:*`/`inventory:*`/`sync:*`. Eligibility is decided in `domain/break-glass.ts` (`ELIGIBLE_RESOURCES` clinical set + `INELIGIBLE_ACTIONS`).
- Without `DATABASE_URL` (unit/e2e), grant persistence no-ops like `MembershipService` — demo escape hatch only; production always records.
- `x-purpose` is rejected up front by `TenantContextGuard` against the §20 list; the policy re-validates as defense in depth (`DENY_PURPOSE_INVALID`).
- Break-glass activation re-validates reason + eligibility inside `BreakGlassService.activate` (guard is not the only caller surface), then persists the grant and emits `BreakGlassActivated`.

## Evidence (live PG `pulse-pg-s26`, migrations 0001–0022)

- Unit: 148/148 (`vitest run`), incl. policy 17, break-glass 6, break-glass service 5.
- E2e: 54/54 (`vitest.config.e2e.ts`, no DB), incl. 5 new contextual-authz tests (break-glass expands missing clinical privilege; financial resource ineligible; invalid `x-patient-id`; invalid `x-purpose`; patient scope without care relationship).
- Integration live: 42/42 (`vitest.config.int.ts`, `pulse-pg-s26` on 5433), incl. 6 new tests in `contextual-authz.integration-spec.ts` (care-assignment narrowing round-trip + lapse, department mismatch/match/facility mismatch, grant TTL/count/outbox, abuse threshold 3/24h, eligibility/reason denials, `sweepExpired` + `BreakGlassExpired`).
- Gates: `tsc --noEmit` 0; `oxlint --type-aware` 0 warnings / 0 errors (232 files); `check-boundaries` ok (173 files); `check-secrets` clean; `pnpm build` 9/9.
- Teardown: `docker rm -f pulse-pg-s26`; `apps/api/tsconfig.build.tsbuildinfo` restored.
