# Sprint 09 — Inventory + Workflow + Documents (R3 operations start)

Goal: facility operations run — immutable stock ledger with batch/expiry, procurement cycle, durable tasks, notification records, document metadata (blobs stay in object storage).
Status: Done (closed 2026-10-08)
Specs: INV-001, ARCH-001 §17/§22/§23, DB-001 §31–§34/§44–§45

## Scope

- [ ] F13.1 Catalog/locations (UOM base unit + conversions, location hierarchy)
- [ ] F13.2 Receive stock (batch/lot + expiry; ledger +)
- [ ] F13.3 Issue/consume/transfer (ledger −/±, balance-guarded, FEFO hint)
- [ ] F13.4 Count/reconciliation (adjustment with reason, history kept)
- [ ] F13.5 Procurement (requisition → PO → receipt posts to ledger)
- [ ] F15.1 Durable tasks (open → done/escalated with timers noted)
- [ ] F15.2 Notifications (recorded via outbox; delivery adapters later)
- [ ] F15.3 Documents (metadata + storage key; blobs in MinIO/S3, never Postgres)
- [ ] Tests: unit (ledger math pure + service fakes), integration live PG (receive→issue→balance→reconcile; procure→receipt; task lifecycle; doc link), e2e DB-less (403/400)

## Non-goals

- Revenue/billing/claims (EPIC-14 → Sprint 10), F15.4 print/export, real SMS/email gateways.

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0008` for real
- `test:int` 13/13 green incl. `operations.integration-spec.ts`: receive→issue→balance(120)→FEFO(EARLY)→reconcile(118); procure→receipt(143); task→done; notify; doc register + path-traversal refused
- Regression: build 9/9, unit 44/44, e2e 20/20 (new: inventory 403, workflow 400), oxlint 0/0 (119 files), boundaries ok (94 files)
- Verify container removed; compose stays canonical on 5432

## Pending

- None. Sprint 09 closed. Next: Sprint 10 — revenue (EPIC-14) to complete R3.
