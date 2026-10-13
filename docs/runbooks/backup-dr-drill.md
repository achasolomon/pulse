# Backup & DR Restore Drill (OPS-001 sections 62-68, F23.2/F23.3)

## Strategy

- **Database**: logical full backup (`pg_dump -Fc`) on a schedule derived from the
  declared RPO (platform default: 24h target, 1h RTO budget for the full restore path).
- **Evidence**: every backup and every drill is recorded in `ops.backup_run`
  with measured evidence (sizes, row counts, checksums, durations). Nothing
  may run "successfully" without landing evidence.
- **Alerting**: staleness of the last successful full backup is an enabled P2
  rule (`backup_staleness_p2`) — see `docs/runbooks/alerting.md#backup-staleness`.

## Running the drill

```bash
# container = the postgres instance under test
export DATABASE_URL="postgresql://pulse:pulse@localhost:5433/pulse"
export PULSE_PG_CONTAINER="pulse-pg-s32"
node scripts/backup-dr-drill.mjs
```

The script:

1. `pg_dump -Fc` the target database (measures dump seconds + size).
2. Registers + completes a `kind=full` backup run with that evidence.
3. Creates an isolated scratch database (`pulse_restore_drill`).
4. `pg_restore` the dump into it (measures restore seconds = observed RTO).
5. Compares **every table's row count** and content checksums (md5 over ordered
   row texts) for `patient.patient`, `audit.audit_event`, `integration.outbox`.
6. Records a `kind=restore_drill` run — `succeeded` or `failed` — and drops the
   scratch database.
7. Exits non-zero on any mismatch.

## DR exercise cadence (section 66)

- **Routine**: full restore drill monthly (the script above).
- **Periodic**: full-stack exercise quarterly — restore, start the API against
  the restored database, run smoke (`pnpm --filter api test:e2e`), validate
  representative clinical records, then approve or reject the recovery point.
- Results land in `ops.backup_run`; defects become tracked findings
  (`security.finding` intake with severity by RPO/RTO impact).

## Measuring RPO/RTO (sections 67-68)

- **RPO** = data-loss window = time between the recovery point used and the
  incident; evidenced by `finished_at` of the last successful backup vs incident time.
- **RTO** = incident declaration → usable service; the drill's `dumpSeconds` /
  `restoreSeconds` are the lower bound for the database path (application
  startup + smoke adds on top — measure in the quarterly full-stack exercise).

## Restore authorization

Restore access is restricted (section 64): drills run under the platform
service credentials; production restores require the incident commander's
approval per the incident runbook.
