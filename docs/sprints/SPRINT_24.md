# Sprint 24 — Blood Bank & Transfusion Safety (R6)

Goal: no incompatible blood ever reaches a patient — ABO/Rh compatibility enforced in code, crossmatch required before issue, transfusion monitored with reaction handling.
Status: Done (closed 2026-10-12)
Specs: LAB-001 §3 (explicitly deferred here), SAFE-001 (transfusion is safety-critical)

## Scope

- [ ] `bank.unit` registry (donation/bag id unique, ABO/Rh, expiry, status collected → tested → available → reserved → issued → transfused/expired/discarded)
- [ ] Pure ABO/Rh compatibility matrix (unit-tested exhaustively); Rh-negative recipients never receive Rh-positive
- [ ] Crossmatch workflow (patient × unit → compatible/incompatible; incompatible blocks issue with 422)
- [ ] Transfusion lifecycle (start → vitals checks → complete; reaction path: stop + graded report mild/moderate/severe)
- [ ] Guards: expired units unissuable; already-issued units single-use; reaction closes with mandatory report
- [ ] Tests: unit (full 8×8 matrix + service fakes), integration live PG (compatible chain + incompatible refusal + reaction), e2e DB-less (403/400)

## Non-goals

- Donor management/recruitment, apheresis, full haemovigilance analytics (later).

## Evidence (live-DB proof 2026-10-12)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0020` for real
- `test:int` 33/33 green (20 files) incl. `bloodbank.integration-spec.ts`: full compatible chain, incompatible recorded-then-refused with issue still blocked, expired blocked, reaction without note refused, graded reaction closes
- Regression: build 9/9, unit 116/116, e2e 47/47 (new: bloodbank 403/400), oxlint 0/0 (216 files), boundaries ok (161 files), secrets clean
- Recurring dynamic-import flake class eliminated repo-wide (static imports; org spec flaked a 4th time before the fix)
- Verify container removed.

## Pending

- None. Sprint 24 closed. Remaining R6: ICU/dialysis/equipment/roster; plus edge runtime, Phase-2b remainder, Next 15.
