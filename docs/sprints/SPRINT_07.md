# Sprint 07 — Orders Foundation + Laboratory (R2 start)

Goal: order-to-verified-result with specimen chain, versioned catalogue, and accountable critical-result acknowledgement.
Status: Done (closed 2026-10-08)
Specs: LAB-001, PULSE-ENG-001 §51 (terminology), DB-001 (lab order/specimen/result/report), ARCH-001 §2 (no silent overwrite — corrections as new versions)

## Scope

- [ ] F09.1 Terminology client: `packages/terminology` (versioned value-set lookup, no silent remap; local codes explicitly namespaced)
- [ ] F09.2/F09.3 generic order semantics via lab order states + cancellation with reason
- [ ] F10.1 Lab order intake (catalogue-version pinned, urgency, indication)
- [ ] F10.2 Specimen collection/accession (label, container, collected-at)
- [ ] F10.3 Result entry (component, value, unit, flag) — amendable only via new result version
- [ ] F10.4 Verify/finalize report (verified-by, verified-at; immutable after)
- [ ] F10.5 Critical result acknowledgement (ack-by/at; unacknowledged critical blocks nothing but stays flagged — accountable workflow per SAFE-001)
- [ ] Tests: unit (order machine pure + service fakes), integration live PG (catalog→order→specimen→result→verify→critical-ack→amend), e2e DB-less (403/400)

## Non-goals

- Analyzer仪器 integration, HL7 ORU ingestion (gateway, R4); blood-bank/transfusion (R6 specialty).

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0006` for real
- `test:int` 8/8 green incl. `lab.integration-spec.ts`: order→collect→accession→critical result→`lab.critical_result` event→ack→amend (versions [1,2])→verify
- Regression: build 9/9 (incl. new `@pulse/terminology`), unit 30/30, e2e 16/16 (new: lab 403/400), oxlint 0/0 (86 files), boundaries ok (66 files)
- Verify container removed; compose stays canonical on 5432

## Pending

- None. Sprint 07 closed. Next: Sprint 08 — imaging workflow + medication/eMAR (EPIC-11/12) to complete R2.
