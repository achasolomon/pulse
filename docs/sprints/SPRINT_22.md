# Sprint 22 — Automatic Charge Generation (Phase-2b billing automation)

Goal: clinical work bills itself — lab/imaging orders, dispenses, and booked appointments project idempotent charges without manual capture, priced from the catalogue (tariff-aware later).
Status: Done (closed 2026-10-11)
Specs: REV-001 (charge capture as projection), EVT-001 (idempotent consumers), CR-001 Phase 2b (partial)

## Scope

- [ ] `rev.billing_rule` (event type → service code + quantity, active flag) + `rev.charge.source_event_id` (unique, idempotency key)
- [ ] `ChargeProjector`: peeks unpublished outbox clinical events (never marks published — delivery stays the relay's job), maps via active rules, captures charges with `source_event_id`; unknown/unmapped types skipped, never failed
- [ ] Secured run endpoint `POST /billing/project` (staff) + documented cron shape; projector is re-runnable with zero duplicates
- [ ] Rules cover: `lab.ordered` → test code, `imaging.ordered` → procedure, `med.dispensed` → medication, `appointment.booked` → CONSULT
- [ ] Tests: unit (mapping pure + projector fakes incl. replay-safety), integration live PG (seed events → project → charges; re-run → zero new), e2e DB-less (403/400)

## Non-goals

- Payer-aware pricing at projection (default price now; tariff hook later), EDI/remittance, capitation.

## Evidence (live-DB proof 2026-10-11)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0018` for real; demo seed (now incl. 4 billing rules) twice-safe
- `test:int` 29/29 green (18 files) incl. `billing.integration-spec.ts`: lab + appointment charges projected once with `source_event_id`; re-run duplicates zero
- Regression: build 9/9, unit 106/106, e2e 43/43, oxlint 0/0 (201 files), boundaries ok (151 files), secrets clean
- Fixes: missing `code_field` caught by seed run (schema corrected before any dependent code shipped); projector assertions scoped per-patient (global outbox is shared by design); nested-DTO validators; v4-UUID e2e note. Verify containers removed.

## Pending

- None. Sprint 22 closed. Remaining Phase 2: EDI/remittance, capitation (separate sign-off).
