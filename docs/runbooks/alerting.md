# Alerting Runbook (OPS-001 sections 43-44, F23.1)

Alert on actionable symptoms. Severity from patient/operational impact.
Every page-worthy alert has a runbook link in its rule row (`ops.alert_rule.runbook`).

## Severity ladder

| Severity | Meaning | Response |
|---|---|---|
| P1 | Immediate patient-safety / major outage / security event | Page now |
| P2 | Severe degradation, core workflow at risk | Page on-call |
| P3 | Limited degradation | Business-hours ticket |
| P4 | Informational / maintenance | Digest |

## Seeded rules

### error-rate

`error_rate_p2` — HTTP 5xx rate ≥ 5% of requests (SLI from `pulse_http_requests_total`).

1. Check `/api/v1/metrics` for which handlers carry the 5xxs.
2. Correlate with the SIEM feed (`/api/v1/security/events`) for authz/abuse spikes.
3. If a deploy just landed, roll back first, diagnose after.
4. Open an incident (OPS-001 section 47) if the breach persists > 15 minutes.

### backup-staleness

`backup_staleness_p2` — no successful full backup inside the declared RPO window.

1. Check `GET /api/v1/sre/backups/status` — staleness vs RPO target.
2. Inspect recent runs `GET /api/v1/sre/backups?kind=full` — running? failed?
3. Re-run `scripts/backup-dr-drill.mjs` against the backup host to verify dump + restore path.
4. If the backup host is down, declare a backup-gap incident: RPO exposure grows every hour without a job.

## Evaluation

`POST /api/v1/sre/alerts/evaluate` (privilege `sre:manage`) runs all enabled rules
deterministically and emits `sre.alert_firing` / `sre.alert_resolved` outbox events.
Automated periodic evaluation lands with the metrics backend (R5); the endpoint
is the source of truth until then.

Alert transitions are recorded in `ops.alert` (one firing instance per rule —
deduplicated). Acknowledgement fields exist for on-call tooling integration.
