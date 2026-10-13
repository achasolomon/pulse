# Sprint 34 — Dialysis / renal recurring-care slice (EPIC-25)

**Status:** done
**Epic:** EPIC-25 — Specialty Expansion (R6). ED (SPRINT_21), theatre (SPRINT_23), blood bank (SPRINT_24) already done — tracker note was stale.
**Specs:** CLIN-001 §22 (recurring treatment programme) + §23 Renal row (dialysis episode, access type, pre/post weights, recurring session protocol); SAFE-001 (each session is a distinct attributable clinical event).

## Scope

- [x] Migration `0029_dialysis.sql` (`dial` schema): `dial.protocol` (immutable versions, seeded HD-STD/HDF v1), `dial.program` (episode: patient, facility, protocol, access type, dry-weight target, active|paused|closed), `dial.session` (scheduled → in_progress → completed | deferred ⇄ | cancelled; pre/post weights + computed ultrafiltration, protocol snapshot, adverse event, reason for defer/cancel; DB CHECKs pair weights and require them on completed).
- [x] Domain: session + program transition tables as pure functions; `validateWeights` (required, 20–250 kg range, post ≤ pre → UF ≥ 0) — assistive guardrails, clinician confirms.
- [x] Module `dialysis` (`DIALYSIS_REPOSITORY` + Kysely repo + service + guarded controller): protocols; program create/list/get + pause/resume/close; session schedule/list + start/complete/defer/reschedule/cancel. Privileges `dialysis:read`/`dialysis:manage`; audited writes; outbox events (`dialysis.program_*`, `dialysis.session_*`).
- [x] Guards: PATIENT_NOT_FOUND 404 / PROGRAM_FACILITY_MISMATCH 422 / PROTOCOL_NOT_FOUND 404 / TARGET_WEIGHT_IMPLAUSIBLE 422; inactive program blocks schedule+start (409 PROGRAM_NOT_ACTIVE); illegal transitions 409 SESSION/PROGRAM_STATE_INVALID; complete without plausible weights 422 (WEIGHT_REQUIRED / WEIGHTS_IMPLAUSIBLE); defer requires ≥5-char reason (400); reschedule requires new time.
- [x] Tests: unit (transition tables + weights pure + service fakes, 6), integration live PG (full chain + guard refusals + outbox evidence, 2), e2e DB-less (403 ×3 + 400 above sentinel, 4).

## Non-goals

- Encounter auto-open per session (optional link), Kt/V adequacy metrics, protocol CRUD beyond seeded versions, chemo/physio §22 siblings, equipment/roster/research (later EPIC-25 sprints).

## Decisions

- **D1** — Protocol versions are immutable rows (`UNIQUE(code, version)`); sessions snapshot `protocol_id` at scheduling, so amending a program's protocol never rewrites session history (CLIN-001 "protocol version used for a session is preserved").
- **D2** — Weights column renamed `deferral_reason` → generic `reason` during the sprint: defer AND cancel both persist a reason (cancel's was otherwise silently dropped).
- **D3** — Plausibility bounds (20–250 kg, post ≤ pre) are hard 422s: implausible measurements should be re-taken, not recorded — assistive, not diagnostic (SAFE-001 pattern from acuity scoring).
- **D4** — Weight pairing enforced in DB CHECK as well as service: `(pre IS NULL) = (post IS NULL)` and completed requires both — the schema refuses half-recorded clinical facts even for direct SQL.
- **D5** — Program pause blocks scheduling and starts (409) but never destroys sessions; resume re-enables. Closed is terminal (ended_at stamped).

## Evidence (live proof, container `pulse-pg-s34`)

| Gate | Result |
|---|---|
| Migration | `0001`→`0029` applied on fresh DB; protocols HD-STD/HDF v1 seeded |
| Integration (live PG) | **69/69 across 30 files**, 2nd consecutive run on same DB (idempotent); `dialysis.integration-spec.ts` 2/2 (chain: program → schedule → defer(no reason→400) → reschedule → start → weights guard(422×2) → complete UF=2.3 + outbox types; guards: facility mismatch, paused blocks start/schedule, closed terminal, facility list) |
| Unit | **244/244** across 49 files (dialysis: 6 across 2 specs) |
| e2e | **89/89** (+4 dialysis 403/400 above sentinel) |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 294 files after fixing 5 useless-spread/unused-import warnings; boundaries 209; secrets clean) |
| Build | `pnpm build` 9/9 |

## Follow-ons

- Remaining EPIC-25: ICU/HDU bed-flow slice, equipment/asset (INV-001 §40), roster/workforce (ARCH-001), research governance.
- Session ↔ encounter auto-open; protocol amendment endpoints (v2+ rows); adequacy metrics (Kt/V) when lab integration matures.
