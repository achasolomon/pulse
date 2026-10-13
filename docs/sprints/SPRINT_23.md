# Sprint 23 — Theatre Perioperative Slice (R6)

Goal: safe surgical flow — book a theatre case, complete the WHO checklist stages in order, and record the procedure against the encounter.
Status: Done (closed 2026-10-11)
Specs: CLIN-001 (theatre paths), SAFE-001 (checklist discipline is a safety control)

## Scope

- [ ] `theat.suite` registry (facility-scoped) + `theat.booking` machine (booked → checked-in → in-progress → completed, cancelled branch)
- [ ] WHO checklist stages (sign-in → time-out → sign-out, strictly ordered, each with items + completer + timestamp; stages cannot be skipped or redone silently)
- [ ] Procedure record (surgeon, anesthetist, notes, start/end) linked to booking + encounter
- [ ] Guards: checklist must reach sign-out before completion; completion emits outbox + audit
- [ ] Tests: unit (checklist order machine + service fakes), integration live PG (book→checklist→record→complete), e2e DB-less (403/400)

## Non-goals

- Anesthesia charts, implant tracking (inventory lots cover this later), ICU/dialysis/blood-bank (R6 later slices).

## Evidence (live-DB proof 2026-10-11)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0019` for real
- `test:int` 30/30 green (19 files) incl. `theatre.integration-spec.ts`: book→check-in→start→refused skip→ordered stages→refused early close→record→completed
- Regression: build 9/9, unit 110/110, e2e 45/45 (new: theatre 403/400), oxlint 0/0 (209 files), boundaries ok (156 files), secrets clean
- Verify container removed.

## Pending

- None. Sprint 23 closed. Remaining R6: ICU/dialysis/blood-bank/equipment/roster; plus edge runtime, Phase-2b remainder, Next 15.
