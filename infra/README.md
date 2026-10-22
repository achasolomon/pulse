# Infra — local stack

Start the project database: `docker compose -f infra/docker-compose.yml up -d postgres`.

API setup and role-testing accounts: [local development runbook](../docs/runbooks/local-development.md). PostgreSQL data persists in the `infra_pulse-pgdata` named volume.

| Service | Port | Credentials |
|---------|------|-------------|
| Postgres 16 | 127.0.0.1:5436 (configurable via `PULSE_POSTGRES_PORT`) | `pulse` / `pulse`, db `pulse` |
| Redis 7 | 6379 | — |
| MinIO (S3) | 9000 API, 9001 console | `pulse` / `pulse12345` |
| Mailhog | 127.0.0.1:1026 SMTP, 127.0.0.1:8026 UI | — |

Connection: `DATABASE_URL=postgresql://pulse@127.0.0.1:5436/pulse`, with `PGPASSWORD=pulse` in the ignored local API environment or terminal environment for migration/seed scripts.

Persistence uses Kysely (ADR-006) and the ordered SQL migrations in `infra/migrations`. Apply them with `node scripts/db-migrate.mjs` after setting the database environment. The API readiness endpoint should report `db: up`.
