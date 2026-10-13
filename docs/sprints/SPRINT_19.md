# Sprint 19 — Edge Sync Foundation (R5 offline start)

Goal: an intermittently connected facility can pull a change feed and push captured events with safe, reviewable conflict handling — no silent overwrites, no duplicates.
Status: Done (closed 2026-10-11)
Specs: ARCH-001 §13 (facility edge), PULSE-EVT-001 (idempotent consumers), DB-001 §90–§91 (edge sync metadata)

## Scope

- [ ] Change feed: `GET /sync/feed?since=&limit=` over `integration.outbox` (created_at,id cursor), guarded, audited
- [ ] Idempotent apply: `POST /sync/apply` batches edge events; dedupe via `integration.inbox` (`event_id` + `edge-sync` consumer); replay-safe
- [ ] Conflict rules per type: `patient.registered` → identifier match opens a review conflict instead of duplicating; `encounter.opened` → unknown patient opens conflict; `observation.recorded` → applies (append-only, never conflicts); unknown types → conflict log
- [ ] `sync.conflict` log (open → resolved with resolution note) + resolve endpoint
- [ ] Tests: unit (cursor encode/decode, rules pure, dedupe with fakes), integration live PG (feed→apply→replay-noop→conflict→resolve), e2e DB-less (403/400)

## Non-goals

- Edge device runtime/packaging, vector clocks, automatic clinical merges, binary sync (R5 later).

## Evidence (live-DB proof 2026-10-11)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0015` for real
- `test:int` 26/26 green incl. `sync.integration-spec.ts`: feed pages with cursors; observation apply + replay-skip; duplicate re-registration conflicts; resolve closes
- Regression: build 9/9, unit 91/91 (1 load flake re-passed isolated, 3rd occurrence logged), e2e 39/39 (new: sync 403/400), oxlint 0/0 (192 files), boundaries ok (145 files), secrets clean
- Load-bearing bug fixed: `String(date).slice(0,10)` produced weekday text (`"Sat Aug 08"`) and `toISOString()` shifted DATEs across timezones — new `toDateOnly()` (local calendar fields) + spec; applied to patient DOB (4 sites) and lot expiry; sync duplicate detection was silently broken without it
- Sync is deliberately stricter than online registration (any similarity signal → review). Verify container removed.

## Pending

- None. Sprint 19 closed. Remaining: EPIC-21 edge runtime/packaging, R6 specialties, Phase-2 insurance, Next 15.
