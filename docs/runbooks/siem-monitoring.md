# Runbook — SIEM monitoring & security detections (SEC-001 §60/61)

**Owner:** Security Operations (alerts route to on-call security lead)
**Surfaces:** `GET /api/v1/security/events` (cursor feed), `GET /api/v1/security/detections` (live clusters)
**Privilege:** `security:read` (tenant context required)

## Feed contract

- Cursor feed over `security.event` (append-only). Page with `cursor` + `limit` (≤500); filter by `severity` | `category`.
- Events are normalized: `occurredAt`, `category`, `action`, `severity`, `actorType`/`actorId`, `facilityId`, `correlationId`, `details` (status/code/path/method only — **never request bodies, tokens or PHI**).
- Producers: HTTP problem filter (auth-relevant 401/403/429), break-glass service (`break_glass.activated`).

## Emitted categories

| Category | Source | Typical severity |
| --- | --- | --- |
| authn | credential/session rejections (401) | medium; **high** for session-invalid/demo-disabled |
| authz | access denials (403 ACCESS_DENIED, context rejections) | medium / low |
| break_glass | activations (high) + rejections (high) | high |
| device | device token/access denials (sync surface) | medium / high |
| integration | partner key rejections | medium |
| abuse | rate-limit trips (429) | medium |

## Detection catalogue (implemented)

| # | Use case (SEC-001 §61) | Signal | Threshold (15 min) | Severity | Response owner |
| --- | --- | --- | --- | --- | --- |
| D1 | Account takeover / credential stuffing | Repeated medium+ authn/device/abuse failures per actor+facility in `security.event` | ≥ 10 | high | Security on-call |
| D2 | Mass record access | ≥ 25 `patient`-resource audit actions per actor+facility in `audit.audit_event` | ≥ 25 | medium | Privacy + security on-call |

Run `GET /security/detections` or query the feed directly. Findings from an investigation are intake via the findings register (below).

## Follow-on detections (not yet implemented)

- Data exfiltration (large export/object download), privilege-escalation (unexpected admin grant), ransomware/backup-tamper, service-token abuse — require export telemetry + role-change events (mapped in SEC-001 §61).
- Read-audit of every patient view (D2 currently sees audited *actions*; patient GETs are not all `@Audited` yet — audit-volume tuning required before enabling view-level audit).

## Findings register (pentest intake, F22.1)

- `POST /security/findings` (`security:manage`) — title, severity (`info|low|medium|high|critical`), component, optional CVSS vector/evidence/owner/due.
- Triage workflow: `open` → `triage` → `mitigate` | `accept` (or straight mitigate/accept from open). Closed states are terminal — regressions are new findings (evidence chain).
- Every transition is audited (`finding.triage|mitigate|accept`) and emits `security.finding_*` outbox facts.

## Release gates (SEC-001 §86)

| Gate | Command |
| --- | --- |
| SAST | `pnpm --filter api exec oxlint --type-aware src/ test/` (0/0 required) |
| Secrets | `node scripts/check-secrets.mjs` |
| SCA | `node scripts/check-sca.mjs` (fails on high/critical advisories) |
| Authz regression | unit `authz-coverage.spec.ts` + live `contextual-authz.integration-spec.ts` |
| Boundaries | `node scripts/check-boundaries.mjs` |
