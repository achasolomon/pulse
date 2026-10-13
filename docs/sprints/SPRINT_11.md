# Sprint 11 — Consent + Referral Exchange (R4 network start)

Goal: governed cross-facility exchange — no referral package moves without active disclosure consent, and every case runs an explicit, auditable state machine. No shared-DB visibility between hospitals.
Status: Done (closed 2026-10-08)
Specs: REF-001, PRIV-001, IAM-001 (consent), DB-001 §35–§36/§41, ARCH-001 §12

## Scope

- [ ] EPIC-16: consent capture (patient, grantee, purpose, scope, window), withdrawal with reason, `canDisclose()` gate (active + window + purpose + scope), disclosure log
- [ ] EPIC-17: referral case (draft → submitted → acknowledged → info-requested ⇄ submitted → accepted/declined → scheduled → in-transit → arrived → closed; cancelled/expired branches), immutable submission package versions, messaging thread, redirect history
- [ ] Rule: submit/accept/transfer require active consent — else 422 `CONSENT_REQUIRED`; withdrawal blocks new sends but never rewrites sent history
- [ ] Receiving facility sees only the submitted package version, never the sender's DB rows
- [ ] Tests: unit (both machines + gates with fakes), integration live PG (consent→refer→ack→accept→transfer→arrive→close + withdrawal-blocks-resend), e2e DB-less (403/400/422)

## Non-goals

- FHIR gateway + partner auth (EPIC-18 → Sprint 12), patient portal (EPIC-19 → Sprint 12), transport/ambulance tracking detail.

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0010` for real
- `test:int` 16/16 green incl. `network.integration-spec.ts`: submit blocked pre-consent → full chain to closed → withdrawal blocks resend, history + disclosure log kept
- Regression: build 9/9, unit 54/54, e2e 24/24 (new: referrals 403, consent 400), oxlint 0/0 (139 files), boundaries ok (110 files)
- Verify container removed; compose stays canonical on 5432

## Pending

- None. Sprint 11 closed. Next: Sprint 12 — FHIR gateway stub + patient portal read models (EPIC-18/19) or R5 hardening.
