# Sprint 16 — Patient Portal & Proxy Access (EPIC-19)

Goal: patients (and authorized proxies) see their own care — appointments, results, prescriptions, bills, referral status — through a separately authenticated surface that can never reach staff endpoints.
Status: Done (closed 2026-10-08)
Specs: UX-001 (portal), PRIV-001 (proxy/minimum-necessary), IAM-001 (separate patient identity)

## Scope

- [ ] Patient accounts: `portal.account` (login_id unique, scrypt-hashed secret, status) + register/login with opaque sessions (hashed, 12h expiry); passwords never logged
- [ ] Proxy grants: `portal.proxy_grant` (dependent ← proxy, relationship, scopes, active window); act-as with scope check; every proxy read audited with both identities
- [ ] Portal reads (all via existing repository ports, patient-scoped): appointments, timeline+results, prescriptions + administrations, invoices + balance, referrals + messages
- [ ] `PatientSessionGuard` (bearer token → ALS portal context); staff guards never apply here and vice versa — separate surface, separate secrets
- [ ] Tests: unit (hash/verify, scope checks, fakes), integration live PG (register→login→read own data; proxy grant→act-as; cross-patient denied), e2e DB-less (401/400)

## Non-goals

- Document download bytes, messaging to clinicians, appointment self-booking (reads + proxy first; writes later).

## Evidence (live-DB proof 2026-10-08)

- Postgres 16 via docker on host 5433: `db-migrate` applied `0001`–`0014` for real
- `test:int` 24/24 green incl. `portal.integration-spec.ts`: register→login→own reads; proxy grant→act-as sees dependent; logout revokes (row asserted)
- Regression: build 9/9, unit 81/81, e2e 32/32 (new: portal 401/400), oxlint 0/0 (175 files), boundaries ok (134 files)
- Fixes: portal login/logout scaffolding cleaned to real revocation; portal-context sessionId; 5 older fakes extended for new port methods; 3 duplicate-brace repairs from port edits. Verify container removed.
- EPIC-19 done (reads + proxy; self-booking/clinician-messaging deferred as scoped).

## Pending

- None. Sprint 16 closed. Remaining: R5 hardening (EPIC-21/22/23/24), R6 specialties, Phase-2 insurance.
