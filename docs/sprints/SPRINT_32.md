# Sprint 32 — EPIC-23 close: SRE alerting + backup/PITR + DR restore drill

**Status:** done
**Epic:** EPIC-23 — Observability, SRE, Backup & DR (OPS-001, NFR-001; F23.1-F23.3)
**Closes:** the remaining EPIC-23 tail ("alerting + HA later" in the tracker). Metrics/ready/throttle/container/runbooks/SLOs already landed in SPRINT_17. Multi-instance HA remains deployment-topology work, not backend code.

## Scope delivered

- **F23.1 — Alerting**: `ops.alert_rule` / `ops.alert` (migration `0028_ops_backup_alert.sql`); seeded P2 rules `error_rate_p2` (5xx ≥ 5% SLI from `pulse_http_requests_total`) and `backup_staleness_p2` (no successful full backup inside RPO window), each with owner + runbook link (OPS-001 §43: every page-worthy alert has a runbook). `AlertService.evaluate()` — deterministic, deduped (one firing instance per rule), emits `sre.alert_firing` / `sre.alert_resolved` outbox events; manual `POST /sre/alerts/evaluate` is the source of truth until periodic evaluation lands with the metrics backend (R5). `MetricsRegistry.snapshot()` aggregates totals + error rate.
- **F23.2/F23.3 — Backup + restore drill**: `ops.backup_run` evidence register (kind full|wal|restore_drill, status, measured evidence jsonb, RPO/RTO targets). `BackupService` (register/complete/list/status; staleness feeds the P2 rule). `scripts/backup-dr-drill.mjs`: `pg_dump -Fc` → isolated scratch DB → `pg_restore` → per-table row-count compare (all 99 tables) + md5 content checksums on `patient.patient` / `audit.audit_event` / `integration.outbox` → records both runs with measured `dumpSeconds`/`restoreSeconds`; exits non-zero on any mismatch.
- **Surface**: `modules/sre` — `GET /sre/alert-rules`, `GET /sre/alerts`, `POST /sre/alerts/evaluate`, `GET /sre/backups`, `GET /sre/backups/status`, `POST /sre/backups`, `POST /sre/backups/:id/complete`; privileges `sre:read` / `sre:manage`, audited writes.
- **Runbooks**: `docs/runbooks/alerting.md` (severity ladder P1-P4, rule procedures), `docs/runbooks/backup-dr-drill.md` (strategy, drill steps, RPO/RTO measurement, cadence per OPS-001 §66).

## Decisions

- **D1** — Alert evaluation is pull-based (`POST .../evaluate`) plus optional timer; no background scheduler in-process yet (multi-instance would double-fire without a leader lock). The evaluate endpoint is deterministic for tests and usable by external cron.
- **D2** — One firing instance per rule (dedupe): repeated breaches update the value, never stack alerts; recovery resolves. Acknowledgement fields exist for on-call tooling but no ack workflow yet (OPS-001 §45 tooling integration).
- **D3** — Drill records evidence AFTER comparison; inserting the register rows before comparison grows the source and self-flags an `ops.backup_run` count mismatch (found and fixed live).
- **D4** — Drill restore target is a scratch database on the same server (isolated, dropped after); cross-region restore is topology work for the pilot deployment. Quarterly full-stack exercise (restore + API smoke) documented in the runbook, not automated.
- **D5** — Backup registration API is the integration point for external schedulers (cron in the deployment); the drill script self-registers its runs. No in-API `pg_dump` spawning (credentials/blast-radius separation, OPS-001 §64).

## Evidence

| Gate | Result |
|---|---|
| Migration | `0028_ops_backup_alert.sql` applied 0001→0028 on fresh `pulse-pg-s32` |
| Integration (live PG) | **67/67 across 29 files**, 2nd consecutive run on same DB (idempotent); `sre.integration-spec.ts` 3/3 (seeded rules + runbook links, backup lifecycle, staleness fire→resolve cycle) |
| Backup/DR drill (live) | `backup-dr-drill.mjs` ok:true — 99 tables, 1930 rows, checksums match (patient/audit/outbox), dump 0s / restore 2s (observed RTO lower bound); `ops.backup_run` rows: full succeeded (verifiedByDrill:true) + restore_drill succeeded |
| Unit | **238/238** across 47 files (sre: 13 across 3 specs + metrics snapshot, +12 new) |
| e2e | **85/85** (+4 SRE authz/validation above sentinel); SASL noise from portal burst test unchanged |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 286 files; boundaries 204; secrets scan clean incl. new allowlist entry for drill-script placeholder URL) |
| Build | `pnpm build` 9/9 |

Live fixes during the sprint: outbox `correlation_id` is uuid — integration spec now passes `randomUUID()`; Kysely has no `executeTakeLast` (use `orderBy desc` + `executeTakeFirst`); drill ordering bug (D3); integration test drains pre-existing firing alerts before asserting a clean fire cycle (shared-DB double-run safety).

## Follow-ons

- Periodic in-process evaluation + leader lock (with multi-instance HA, R5).
- Ack workflow + on-call routing integration (OPS-001 §45).
- Quarterly full-stack DR exercise automation (restore + API smoke); cross-region restore topology at pilot.
- WAL archiving / true PITR (current: logical full backups; PITR needs archive_mode + WAL shipping in the deployment topology).
- Latency/budget alerts (p95 per SLO tier from `docs/SLO.md`) once the metrics backend lands.
