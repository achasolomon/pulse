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

## Orthanc PACS development environment

Run `node scripts/setup-local-pacs.mjs` from the repository root, then `docker compose -f infra/compose.pacs.yml up -d orthanc`. The pinned Orthanc image exposes HTTP/DICOMweb at **127.0.0.1:8043** and DICOM at **127.0.0.1:4243**, with called AE **PULSE_DEV**. Credentials and generated configuration are under ignored `tmp/pacs/`; the setup script never prints the password. Storage persists in the compose named volume. Do not remove that volume to restart the service.

The API loads ignored `tmp/pacs/.env.api` after its normal `.env` in development only; environment/deployment settings take precedence, and tests ignore env files. Restart the API after generating/changing PACS configuration. Production must supply an HTTPS endpoint and deployment-managed service credentials. The clinical browser receives only sanitized connection status; it receives no PACS credentials or arbitrary REST proxy. The Radiology screen can refresh the **Orthanc PACS** indicator. QIDO connectivity checks use one filtered sentinel UID, not an unbounded study listing.

Verify with `PULSE_PACS_SYNTHETIC_TEST=yes node scripts/check-local-pacs.mjs` (PowerShell: set the environment variable first). The guarded script confirms the named localhost development server, authenticated/unauthenticated behavior and a synthetic DICOMweb store/query/retrieve metadata roundtrip, then deletes only its generated study. It creates no Pulse clinical records. Unknown DICOM modalities are not granted storage/query/move access; actual modality AE/IP registration remains to be configured. This sandbox is not a clinically approved PACS deployment or a diagnostic viewer.

The check uses three generated grayscale phantom images, verifies rendered 128x128 pixels and checks every instance against the expected patient ID, facility issuer, accession, study UID, modality and birth date. Altered identity bindings must be rejected. The production gateway returns only verification counts or safe failure classifications; it does not expose retrieved metadata to the clinical browser. Build the API TypeScript output before running this developer script, which imports the compiled gateway. Passing this test does not create a Pulse acquisition work item or change a clinical order's status.

The staff acquisition workflow is wired separately: a reviewed procedure-day checklist generates a persisted Pulse accession/study UID and the facility-specific expected identity binding. Staff then request verification of that exact study; the server links matching Orthanc metadata and records acquisition atomically. For a complete synthetic browser exercise use `apps/web-clinical/tests/radiology-acquisition-smoke.mjs` with the isolated review API/web on 3048/3018, disposable PostgreSQL on 5437, `DATABASE_URL`, `PULSE_DISPOSABLE_DB=yes` and `PULSE_PACS_SYNTHETIC_TEST=yes`. It creates and cleans its own clinical fixtures and three-image Orthanc study. Do not point that runner at the normal database or add synthetic-upload controls to the clinical UI.

Configuration follows the [Orthanc Docker documentation](https://orthanc.uclouvain.be/book/users/docker-orthancteam.html), [DICOMweb plugin documentation](https://orthanc.uclouvain.be/book/plugins/dicomweb.html) and [synthetic DICOM creation API](https://orthanc.uclouvain.be/book/users/advanced-rest.html). Container tag used and verified: `orthancteam/orthanc:26.9.1`.
