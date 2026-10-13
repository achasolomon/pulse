# Sprint 25 — Staff Authentication (F03.1): retire the demo contract

Goal: credentials, sessions, and MFA you can pilot — while every existing test keeps passing via an explicit non-production demo escape hatch.
Status: Done (live-DB proof 2026-10-12)
Specs: IAM-001 §5/§8, SEC-001 (credential handling), EPIC-03 F03.1

## Scope

- [x] `iam.credential` (scrypt hash, status, TOTP secret + enabled flag), `iam.session` (hashed opaque token, 8h expiry, revocation), `iam.identity_link` (SSO provider ↔ person seam) — migration `0021_staff_auth.sql`
- [x] Login (uniform 401s, throttled 5/min like portal), logout revocation (`POST iam/auth/logout` takes the `Bearer staff_` token), TOTP enroll (otpauth URL) + verify with ±1 window, MFA challenge on login when enabled
- [x] `AuthorizationGuard` session path: `Authorization: Bearer staff_<token>` resolves person → DB membership; demo headers honored ONLY when `ALLOW_DEMO_AUTH=true` (tests set it; production defaults off → `DEMO_DISABLED`)
- [x] SSO seam: link/unlink provider subjects; login-via-SSO itself lands with the federation adapter (documented)
- [x] Tests: unit (TOTP RFC 6238 vectors, credential round-trip, demo-gate, logoutByToken), integration live PG (register→login→guard-accept→logout-revoke; MFA enforced; demo-off denies), e2e (403/400 + demo gate)

## Non-goals

- Password rotation/reset flows, federation protocol work, workforce UI.

## Decisions

- TOTP: RFC 6238 SHA-1, 6 digits, 30s step, ±1 window; RFC vectors asserted in unit tests.
- Secrets: Node `scrypt` (N=16384); session tokens are opaque `staff_<random>`, only the SHA-256 hash is stored; login is a uniform 401 on any failure.
- Demo escape hatch: `ALLOW_DEMO_AUTH=true` is honored only as an explicit non-production flag; e2e sets it, production defaults to deny.
- `IamModule` now imports `OutboxModule` (publishes `staff.registered` / `staff.mfa_enabled` / `staff.identity_linked`).
- Integration assertions match exception **message** text, not ProblemDetails `code` (repo convention; `toThrow` only sees messages).

## Evidence (live Postgres 16, container `pulse-pg-s25`, port 5433)

- Migrations `0001`–`0021` applied clean (`scripts/db-migrate.mjs`).
- `test:int` **36/36** (21 files), including `staff-auth.integration-spec.ts` 3/3:
  - register → login → session resolves membership (`patient:read`) → logout revokes (`findSession` → undefined)
  - MFA enroll → wrong code rejected → live code enables → login demands TOTP → live code passes
  - demo headers denied when `ALLOW_DEMO_AUTH` unset (`DEMO_DISABLED` path)
- Unit **123/123** (TOTP RFC vectors, scrypt round-trip, uniform 401, MFA challenge, logoutByToken).
- E2E **49/49** (`iam/auth` register 403 without context, login 400 on empty body; suite runs with `ALLOW_DEMO_AUTH=true`).
- Gates: `tsc` 0, oxlint 0/0 (224 files), boundaries ok (167), secrets clean, `pnpm build` 9/9.
- Container removed; `tsconfig.build.tsbuildinfo` restored.

## Follow-ups

- Enroll/confirm TOTP routes currently gate on `iam:manage` privilege; binding enrollment to an *existing session* of the same credential is Phase-2 hardening.
- Federation protocol adapter (OIDC/SAML) consumes the `identity_link` seam; SmartCard/PIV later.
- Pre-existing (not this sprint): portal login burst test logs SASL noise when e2e runs without `DATABASE_URL` — guard predates F03.1.
