# Runbook — Incident Response Skeleton (OPS-001, EPIC-23)

Severity follows patient-safety impact first (SAFE-001 §3.1): any suspected
clinical-data corruption or unauthorized PHI access is SEV-1 regardless of uptime.

## Triage (first 15 minutes)

1. `/api/v1/health/live` + `/api/v1/health/ready` — is the app up? is `checks.db` up?
2. `/api/v1/metrics` — error-rate spike by handler? latency bucket shift?
3. `integration.outbox WHERE published_at IS NULL` growing? (relay stall)
4. `audit.audit_event` last hour by action — break-glass or bulk export anomalies?

## Containment

- Revoke partner keys: `UPDATE integration.partner SET active=false WHERE id=...`
- Revoke portal sessions: `UPDATE portal.session SET revoked_at=now() WHERE account_id=...`
- Disable tariff/contract silently? Never — suspend via `status='suspended'` rows, never deletes.
- Rollback deploys via prior container tag; migrations are expand-only so old code keeps running.

## Evidence to preserve

- Correlated logs by `x-correlation-id`, `fhir_log` rows, disclosure log, outbox unpublished set, and a database dump **before** any repair (`scripts/db-backup.mjs`).

## Review

- Every SEV-1/2 gets a blameless review with: timeline, hazard-log entry, regression test, and runbook update. No silent data repair — governed `data repair` path per DB-001 §98 only.
