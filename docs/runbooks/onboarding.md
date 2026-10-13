# Runbook — Facility Onboarding (ONB-001, EPIC-24 partial)

Discover before configuring; standardize before customizing; rehearse before go-live.

## 1. Discovery (before any config)

Capture: facility type, departments, working hours, patient volumes, existing
MRN scheme, payer mix, catalogue needs (labs/meds/services), tariff contracts,
network reliability (edge needed?), user roles and headcount for training.

## 2. Provision

```bash
# 1. migrate to the released cut (all 0001..NNNN, in order):
DATABASE_URL=<prod> node scripts/db-migrate.mjs
# 2. seed the demo/reference catalogues (idempotent, twice-safe):
psql $DATABASE_URL -f infra/seeds/demo-facility.sql
psql $DATABASE_URL -f infra/seeds/demo-facility.sql  # must change nothing
# 3. verify:
psql $DATABASE_URL -c "SELECT code FROM org.facility;"
psql $DATABASE_URL -c "SELECT count(*) FROM ins.tariff_line;"
```

## 3. Configure (never fork)

Facility-specific values go in rows (departments, tariffs, facility record),
never in code or branches. Record the facility's payer contracts with effective
windows; publish tariff v1 and reconcile one sample invoice per payer before training.

## 4. Train against real workflows

Role-based walkthroughs on the training environment: registration → encounter →
orders → dispense/eMAR → charge → invoice → claim. Break-glass drill included
(reason required, audit verified in `audit.audit_event`).

## 5. Cutover rehearsal

Full backup (`docs/runbooks/backup-restore.md`) → rehearsed migration →
smoke suite (vertical-slice checklist in `docs/BACKLOG_TRACKER.md`) →
go-live with hypercare staffing. No unresolved critical safety gap at activation.
