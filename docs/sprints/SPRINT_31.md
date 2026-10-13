# Sprint 31 — EPIC-22 close: SIEM telemetry, detections, SCA gate, pentest triage (F22.1)

**Status:** done
**Target:** close EPIC-22 "Security, Privacy & Compliance Engineering" — remaining stories: security verification (SAST/SCA/secrets, authz tests, pentest findings triaged) + SIEM/SOC telemetry (SEC-001 §60/61/85/86). Sprints 07/18/22 already delivered secrets gate, authz gate, break-glass governance, audit.

## Scope

### Migration `0027_security_siem.sql`
- `security.event` — append-only normalized SIEM events (category `authn|authz|break_glass|admin|integration|device|privacy|abuse`, severity, actor triple, facility, correlation, non-PHI details jsonb) + indexes for feed/detectors.
- `security.finding` — pentest/SCA finding register (severity, status `open|triaged|mitigated|accepted`, CVSS vector, component, evidence, owner, remediation, triage timestamps).

### Platform
- `platform/security/security-event.service.ts` — `SecurityEventService.record()` (never throws; no-op without DB) + pure `classifySecurityFailure()` (401/403/429 → category/severity/action; routine 400/404/409 unclassified → zero feed noise) + `actorFromHeaders()` (tokens never recorded; facility must be UUID).
- `HttpProblemFilter` — DI-constructed (`app.get` in bootstrap); emits classified failures with status/code/path only.
- `platform/security/security.module.ts` — `@Global()` provider of the recorder + filter.
- `BreakGlassService` — emits `break_glass.activated` (high) to the feed on every grant.

### Module `security`
- **FindingService** — intake (validated), list/get (status/severity filters), `triage|mitigate|accept` state machine: open→any, triaged→mitigate|accept, closed terminal (regressions = new findings, evidence chain). Outbox `security.finding_intaken|_triaged|_mitigated|_accepted`; `@Audited` on every transition.
- **SiemService** — cursor feed (base64url cursor, severity/category filters, limit ≤500) + detectors: D1 repeatedAuthFailures (≥10 medium+ authn/device/abuse events per actor+facility / 15 min), D2 massPatientTouches (≥25 patient-resource audit actions per actor+facility / 15 min).
- **Controller** `security` — `GET events|detections` (`security:read`), `POST/GET findings` (`security:manage`/`read`), guarded by TenantContextGuard + AuthorizationGuard.

### Gates & artifacts
- `scripts/check-sca.mjs` — SCA gate: `pnpm audit --json`, fails on high/critical (SEC-001 §86).
- `docs/runbooks/siem-monitoring.md` — feed contract, category table, detection catalogue D1/D2 with severity/owners, follow-on detections, gate commands.
- `docs/runbooks/pentest-plan.md` — scope (SEC-001 §85), RoE, triage SLAs, evidence pack.

## Decisions
- D1 — SIEM telemetry is fail-open-safe: `record()` never throws and no-ops without `DATABASE_URL` (unit/e2e); a telemetry failure must not affect care paths.
- D2 — only auth-relevant statuses (401/403/429) are classified into the feed; request bodies/tokens/PHI are never recorded (details = status/code/path/method).
- D3 — findings transitions are one-way: closed states terminal; regressions are new findings (auditable chain, no silent reopen).
- D4 — detectors are threshold-based (15-min window) over `security.event` + `audit.audit_event`; runbook documents follow-on use cases (exfiltration, escalation, ransomware) and the view-audit prerequisite for full mass-access coverage.
- D5 — SCA gate ships **reporting on known advisory debt**: the sprint live-proofs it by intake+triage of the current advisory set (next/undici/postcss/tmp) into the findings register; dependency upgrades are explicit follow-on work, not hidden.

## Evidence
| Gate | Result |
| --- | --- |
| Migration | `0027_security_siem.sql` applied live (`pulse-pg-s31`, migrations 0001-0027) |
| Integration (live PG) | **64/64** across 28 files (incl. `sca-triage.integration-spec.ts` engagement); `security.integration-spec.ts` 4/4 (feed paging/filters, D1+D2 detector hits, findings lifecycle, actor mapping) |
| Unit | **227/227** across 44 files (security: 16 across 5 specs, +14 new) |
| e2e (no DB) | **81/81** (+5 above sentinel: events 403, detections 403, findings 403/400, triage id 400) |
| SAST (oxlint) | 0/0 (275 files) |
| Secrets | clean |
| SCA | gate functional: exit 1 with **2 critical + 16 high** advisories (next, undici, postcss, tmp) — all intake + triaged live via the findings register (see below) |
| tsc | 0 errors |
| Boundaries | ok (198 files) |
| Build | 9/9 |

Live SCA triage evidence (register rows on `pulse-pg-s31`): `deps/next` critical (2 critical + 8 high, owner `web-platform`), `deps/undici`/`deps/postcss`/`deps/tmp` high (owner `api-platform`) — all status `triaged` via the `sca-triage.integration-spec.ts` engagement. Cursor µs-precision fix applied to both security and sync feeds (page-boundary duplication). Teardown: container removed, tsbuildinfo restored.

## Follow-on (tracked, not blocking EPIC-22)
- Dependency upgrade train for next/undici/postcss/tmp to clear the SCA gate (owner per finding).
- View-level patient-read audit for full D2 mass-access coverage (audit-volume tuning first).
- Remaining SEC-001 §61 detections (exfiltration, escalation, ransomware, service-token abuse).
