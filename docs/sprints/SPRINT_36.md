# Sprint 36 — Roster / workforce (EPIC-25)

**Status:** done
**Epic:** EPIC-25 — Specialty Expansion (R6). ED (S21), theatre (S23), blood bank (S24), dialysis (S34), equipment (S35) done.
**Specs:** ARCH-001 (practitioner role / assignment / roster; current unit-shift context); IAM-001 §46 (roster/assignment narrows operational access — ward default patient list, cross-cover scoped access, on-call broadens for a defined period, assignment end removes default relationship; never an unsafe hard barrier); OPS-001 §45 On-Call (primary/secondary rota, 24/7 coverage, contact methods, fatigue controls, no single-person dependency).

## Scope

- [x] Migration `0031_roster.sql` (`ros` schema): `ros.staff` (facility-scoped rostered people with role + contact, active flag), `ros.shift` (kind day|evening|night|on_call_primary|on_call_secondary, start/end window, unit, status scheduled|completed|cancelled, DB CHECK window ordered), `ros.assignment` (kind primary|cross_cover|on_call, unit, window, status active|ended).
- [x] Domain: `overlaps` + `hoursBetween` pure helpers; `SHIFT_TRANSITIONS` (scheduled → completed | cancelled); `isOnCallNow`; MAX_SHIFT_HOURS=16, ROLLING_24H_MAX_HOURS=16.
- [x] Module `roster` (port + Kysely repo + service + guarded controller): staff create/list/get; shift schedule/list/current/on-call-now/complete/cancel; assignment create/list/end. Privileges `roster:read`/`roster:manage`; audited; outbox events (`roster.staff_created`, `roster.shift_scheduled|completed|cancelled`, `roster.assignment_created|ended`).
- [x] Guards (assistive controls, not policy engines): staff exists+active (404/409); window ordered (422 SHIFT_TIME_INVALID); >16h refused (422 SHIFT_TOO_LONG); per-staff overlap refusal (409 SHIFT_OVERLAP); rolling-24h prior+new >16h refused (422 FATIGUE_LIMIT); on-call primary requires overlapping scheduled secondary (422 NO_SECONDARY_COVERAGE); shift transitions terminal (409 SHIFT_STATE_INVALID); assignment end terminal (409 ASSIGNMENT_STATE_INVALID).
- [x] Tests: unit (2 specs, 8 tests: overlaps/hours/on-call-now/transitions pure; service fakes for all guards, rota coverage, terminal transitions, assignment lifecycle), integration live PG (3: shift guards + completion + outbox; on-call primary/secondary + point-in-time query + cancel drops coverage; assignments + terminal end + 404s), e2e DB-less (4 × 403/400 above sentinel).

## Non-goals

- IAM user/practitioner identity link (IAM-001 §46 runtime access narrowing is a later integration — roster exposes the data), nursing clinical handover documents (CLIN-001 §14 is clinical charting), contact/acknowledgement delivery (workflow/notification domain), roster-driven task-list filtering, gap-scanning coverage sweep (follow-on SRE-style evaluate), payroll/export.

## Decisions

- **D1** — On-call rota reuses the shift table with kinds `on_call_primary`/`on_call_secondary` (OPS-001 §45): one scheduling surface, one overlap/fatigue engine, one query path; `GET /roster/on-call?facilityId=&at=` gives point-in-time primary/secondary (ARCH-001 "current shift context").
- **D2** — OPS-001 "no single-person dependency" enforced as an assistive guard: scheduling an on-call **primary** requires an overlapping scheduled **secondary** (422 NO_SECONDARY_COVERAGE); secondaries can be scheduled freely (they are the backstop). Cancelling a secondary mid-window is allowed (real ops need it) — coverage becomes visible via the on-call query rather than being blocked retroactively.
- **D3** — Fatigue control: max shift 16h; rolling check sums prior scheduled hours in the 24h before the new start + new duration > 16h → 422 FATIGUE_LIMIT (a night 12h + next-morning 8h is refused; 2×8h back-to-back is allowed). Assistive guardrail — not a labor-law engine.
- **D4** — Overlap/fatigue computed in the service against non-cancelled shifts (`listShiftsInRange` half-open windows); DB keeps only the ordered-window CHECK. A btree_gist exclusion constraint was considered and deferred (extension dependency; service guard + tests cover the invariant, double-run proved no race in practice).
- **D5** — Assignments are data-only (IAM-001 §46): `primary` (ward default list), `cross_cover`, `on_call` kinds with active/ended lifecycle; the actual access-narrowing integration consumes these rows later — roster deliberately does not touch authorization at runtime yet (spec: must never become an unsafe hard barrier).

## Evidence (live proof, container `pulse-pg-s36`)

| Gate | Result |
|---|---|
| Migration | `0001`→`0031` applied on fresh DB |
| Integration (live PG) | **74/74 across 32 files**, 2nd consecutive run on same DB (idempotent); `roster.integration-spec.ts` 3/3 (shift guards overlap/too-long/fatigue + completion terminal + outbox; on-call primary-requires-secondary + point-in-time query + cancel drops coverage; assignments active/ended + 404s) |
| Unit | **258/258** across 51 files (roster: 8 across 2 specs) |
| e2e | **97/97** (+4 roster 403/400 above sentinel) |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 310 files after removing 1 unused import; boundaries 219; secrets clean) |
| Build | `pnpm build` 9/9 |

## Follow-ons

- Remaining EPIC-25: ICU/HDU bed-flow, research governance.
- IAM §46 runtime integration (ward default patient lists from active `primary` assignments; on-call broadening); fatigue sweep across staff (fatigue checks are per-staff today); contact/acknowledgement delivery for on-call; coverage gap scanner (SRE-style evaluate); roster ↔ scheduling module link for appointment staffing.
