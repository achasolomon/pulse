# Runbook — Backup & Restore Drill (OPS-001, EPIC-23)

## Backup

```bash
# Against the compose database (canonical port 5432; override when occupied):
docker exec pulse-postgres pg_dump -U pulse -Fc -f /tmp/backup.dump pulse
docker cp pulse-postgres:/tmp/backup.dump backups/pulse-<date>.dump
# or wrapper (verifies with pg_restore --list):
node scripts/db-backup.mjs --docker pulse-postgres
```

Retention: daily custom-format dumps, 30 days, off-host copy. PITR (WAL archiving) is a production-topology item — not yet enabled; RPO is currently "last dump".

## Restore drill (required before every pilot cutover)

```bash
createdb -h localhost -U pulse pulse_restore
pg_restore -h localhost -U pulse -d pulse_restore backups/pulse-<date>.dump
psql -h localhost -U pulse -d pulse_restore -c "SELECT count(*) FROM patient.patient;"
psql -h localhost -U pulse -d pulse_restore -c "SELECT count(*) FROM integration.outbox WHERE published_at IS NULL;"
```

Pass criteria: restore completes with zero errors; row counts match the pre-backup `SELECT count(*)` recorded in the drill log; app boots against `pulse_restore` with `/api/v1/health/ready` reporting `db: up`.

## Readiness contract

- `GET /api/v1/health/live` — process alive (container HEALTHCHECK).
- `GET /api/v1/health/ready` — `{ status: 'ok', checks: { app, db } }` where `db` is `up` | `down` | `not-configured`. Orchestrators gate traffic on `checks.db == up` when `DATABASE_URL` is set; `not-configured` is expected only in DB-less test/dev.
