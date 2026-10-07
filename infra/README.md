# Infra — local stack

`docker compose -f infra/docker-compose.yml up -d`

| Service | Port | Credentials |
|---------|------|-------------|
| Postgres 16 | 5432 | `pulse` / `pulse`, db `pulse` |
| Redis 7 | 6379 | — |
| MinIO (S3) | 9000 API, 9001 console | `pulse` / `pulse12345` |
| Mailhog | 1025 SMTP, 8025 UI | — |

Connection: `DATABASE_URL=postgresql://pulse:pulse@localhost:5432/pulse`

Migration tooling decision deferred to Sprint 02 (ADR-003): candidates TypeORM / Prisma / Kysely + `db-migrate` expand/contract discipline per `PULSE-DB-001 §92–§96`. Sprint 01 ships no tables — `outbox`/`inbox` DDL lands with the ORM choice.
