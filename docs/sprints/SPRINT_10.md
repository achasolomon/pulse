# Sprint 10 — Revenue Cycle (complete R3)

Goal: money follows care without ever rewriting it — charge capture as projection of clinical events, invoices, payments/refunds, coverage/eligibility, claim lifecycle with denial handling.
Status: Done (closed 2026-10-08)
Specs: REV-001, DB-001 §37–§40, ARCH-001 §21

## Scope

- [ ] F14.1 Charge capture (service catalogue + tariff price pinned at capture; cancel needs reason, never deletes)
- [ ] F14.2 Invoice (draft → final; lines reference charges; void with reason)
- [ ] F14.3 Payment (allocate to invoice; balance derived; refund/adjustment with reason, never reverses care)
- [ ] F14.4 Coverage + eligibility check + authorization record
- [ ] F14.5 Claim lifecycle (draft → submitted → acknowledged → paid/denied → appealed; denial reason kept)
- [ ] Separation rule tests: payment/denial/refund never touch encounter/procedure state
- [ ] Tests: unit (invoice math pure + service fakes), integration live PG (full money chain), e2e DB-less (403/400)

## Non-goals

- Real payer integrations/EDI (R4 adapters); tariff versioning engine (flat price + override for now, versioned in R5).

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0009` for real
- `test:int` 15/15 green incl. `revenue.integration-spec.ts`: charge→invoice(15000)→partial→paid→refund(2000 owed) with encounter still `open`; coverage→eligibility→authorization→claim deny/appeal→paid
- Regression: build 9/9, unit 50/50, e2e 22/22 (new: revenue 403/400), oxlint 0/0 (127 files), boundaries ok (100 files)
- R3 now complete (EPIC-13/14/15). Verify container removed.

## Pending

- None. Sprint 10 closed. Next: Sprint 11 — R4 network (consent EPIC-16 + referral exchange EPIC-17).
