# Sprint W02 — Typed transport, secure staff session and facility bootstrap

**Status:** done (development foundation, 14 October 2026).
**Specs:** FE-001 transport/errors/session/security; UX-001 session lifecycle/context/responsive/keyboard behavior; IAM-001 staff authentication and membership. Full product scope remains in [the delivery plan](../FRONTEND_DELIVERY_PLAN.md) and [scope catalogue](../FRONTEND_SCOPE_CATALOGUE.md).

## Completed scope

- [x] Shared login/expiry and staff-context types, centralized backend and same-origin browser clients, correlation, safe machine-code errors, cancellation and private fetches.
- [x] Backend `GET /iam/auth/me`: authoritative actor/expiry/current facility memberships, organization/facility names, roles and presentation privileges. Rejects malformed/revoked/expired sessions, disabled credentials and service accounts without a staff person; dependency failure is unavailable, not empty access.
- [x] Staff authorization requires actual active membership and the matching organization/facility tuple. Demo headers cannot supply missing staff privileges; production disables demo auth. Exported IAM repositories resolve the real bearer strategy dependencies.
- [x] Encrypted authenticated `HttpOnly` cookie replaces unsigned JSON. No client token/storage; eight-hour absolute bound, invalid-cookie recovery, backend verification on protected reads and no renewal on facility switch.
- [x] BFF login/logout/session/facility routes, complete Origin checks and SameSite policy. Logout confirms revocation or reports retryable unavailability. Failed login bootstrap attempts session cleanup.
- [x] Login/MFA challenge, required credential/code validation, duplicate-submit prevention, safe support reference and cleared credentials on success.
- [x] Explicit facility selection from server memberships, foreign selection denied, no-membership guidance and full navigation on switching.
- [x] Workspace shows actual staff/facility/roles. Removed mock clinical dashboard, nonfunctional navigation and unavailable patient-search prompt. Brand examples inform direction and quality, not final designs.
- [x] Shell revalidates on focus/interval, reacts to membership/capability changes and absolute expiry, exposes service errors. Mobile drawer traps focus, makes main inert, closes on Escape and restores focus.
- [x] Regression/live database/BFF/browser evidence, setup documentation and tracker.

## Decisions

See [ADR-008](../ADRs/ADR-008-staff-web-session.md). Backend persistence remains authoritative; the encrypted cookie carries transport/context only. UI capabilities never grant API access. Context bootstrap entered W02 because safe facility selection depends on it.

No patient data is connected. Completion covers this bounded foundation, not every catalogue item assigned to the broader W01/W02 band. Provisioning, self-service security/recovery, break-glass UI and other administration retain their catalogue scope and need dedicated increments. OpenAPI generation, federation and refresh rotation remain follow-on work.

## Evidence

Verified 14 October 2026 against disposable `pulse-pg-w02-review` PostgreSQL 16 on loopback port 5437, with all 33 migrations applied and synthetic identities only. Existing user databases were not used.

| Check | Result |
|---|---|
| Web cookie/CSRF tests | 6 passed |
| API-client tests | 11 passed |
| Shared UI tests | 19 passed |
| Backend unit regression | 276 passed |
| Backend HTTP regression without database | 105 passed |
| Staff auth/context database integration | 7 passed |
| Typecheck/lint | Web, API and API-client passed |
| Production build | Clinical Next app and Nest API passed |
| Boundaries/secrets/diff whitespace | Passed |
| Live BFF smoke | Login, opaque/private cookie, identity, allowed/denied facility selection, membership expiry, tampering, logout/revocation and login recovery passed |
| Headless Chrome | Login/MFA, facility selection/logout, no readable cookie/storage, desktop/mobile reflow, drawer focus/Escape passed |
| API outage fault injection | Session and logout return 503; cookie remains available for retry; no false revocation success |

Opt-in runners: `apps/web-clinical/tests/live-auth-smoke.mjs`, `browser-auth-smoke.mjs` and `outage-auth-smoke.mjs`. They require `PULSE_DISPOSABLE_DB=yes` and `DATABASE_URL`, restrict database writes to loopback 5437/database `pulse`, create synthetic fixtures and remove their own rows. Temporary frontend/API ports are 3017/3047. The outage runner pauses after login; stop only the temporary API, then press Enter to inject failure. Ignored local screenshots: `tmp/w02-evidence/`; these are not final design approval.

The existing database-free portal-abuse test logs a PostgreSQL SASL connection error while testing fallback, but its assertions pass. Worker-based checks required execution outside the restrictive process sandbox; successful runs are reported above.

## Login design review follow-up — 14 October 2026

Scrolling adjustment: the login frame fits the dynamic viewport; only the sign-in panel scrolls. The image panel stays fixed, with tighter spacing/type on short desktop windows so its complete content remains visible. Chrome checks passed at 1440×900, 1440×500, 960×300, 390×568 and 320×568: no document scrolling, all desktop brand-panel content within bounds, and independent form-panel scrolling when needed.

Subsequent visual adjustment: the brand panel uses the user-provided consultation photo `/assets/bg.jpg`, cropped with `cover` and a dark teal overlay for readable text. Removed the decorative heartbeat illustration. Public `/assets` images are accessible before login; the workspace remains protected. Verified the image's unauthenticated 200 response, workspace redirect, Chrome desktop rendering, build, lint and typecheck.

Review builds use `PULSE_NEXT_DIST_DIR=tmp/login-review-build` to avoid conflicts with an active development server. The browser runner respects the real login throttle, waiting for its window before the sixth attempt; the API limit is unchanged.

Implemented the requested login redesign before progressing to clinical screens. Desktop uses a balanced teal brand/story panel with original decorative heartbeat artwork and a focused white form. Mobile uses a single column. The horizontal brand asset keeps its native aspect ratio; the distorted background artwork is no longer used on login. Typography, spacing and short introductory copy separate the primary task from the audit notice.

Added accessible password Show/Hide (hidden again on submit), expandable account/MFA assistance, a distinct MFA step with focused code entry and change-account recovery, focused error feedback, and cleared password on credential rejection. Existing BFF/session/facility contracts remain in use. Recovery instructions describe the facility administrator process; no unimplemented reset, SSO, Smart Card or persistent-login control is presented.

Verification: production build, web lint/typecheck and real Chrome login/MFA walkthrough. Browser coverage includes 1440px desktop, 390px mobile, 320px reflow with simulated 200% text enlargement, password visibility/reset, assistance, failed-login focus, MFA invalid-code recovery/change account and existing facility/logout/navigation behavior. Local screenshots: `tmp/w02-evidence/login-desktop.png`, `login-mobile.png`, `login-mobile-large-text.png`, `login-mfa.png`. Visual approval remains part of the user's screen review; this is not a completed product accessibility audit.

## Facility-selection design review follow-up — 14 October 2026

Replaced the earlier generic selection card with a dedicated responsive workspace-selection page: proportionate brand lockup, actual signed-in account, native facility selector, selected organization/facility/role preview, deliberate Open workspace action and secondary account-switch/sign-out control. Displayed facilities remain backend-derived; selection still uses the validated BFF and full navigation. Failures focus accessible feedback and retain correlation references. No-membership guidance keeps sign-out available without offering a workspace the account cannot access.

Verified the production build, lint/typecheck, secret/diff checks and real Chrome login/facility/logout/MFA flow against disposable synthetic data. Browser evidence covers desktop/mobile selection preview and a revoked membership producing No active facility access with no selector/Open workspace action. Local screenshots: `tmp/w02-evidence/facility-desktop.png`, `facility-mobile.png`, `facility-no-access.png`. The existing browser runner also accepts `--facility-preview` to capture only the selection previews after login. This finishes implementation of this screen's review pass; user visual acceptance remains separate.

## Current authentication UX and recovery — 14 October 2026

This supersedes the earlier screen-review layouts above. Login follows the user's newer rounded split-panel/card reference with Pulse branding and their background asset. Only the form side scrolls. There is no SSO control or Google federation dependency; SSO was explicitly excluded by the user. MFA is an optional account-security setting, never an alternative/default login method. Once confirmed, it becomes the required second password-sign-in step. Setup keys are encoded in standard Base32 for authenticator apps; existing stored Base64 HMAC keys remain compatible.

After login, staff enter `/` directly. If no facility is selected, a compact native modal opens over the generic dashboard: title, dropdown, Open workspace and Sign out only. Its background is inert and keyboard focus is confined by native dialog behavior. The header dropdown switches facilities using validated backend membership and full navigation; no dedicated selection screen interrupts login. `/select-facility` is now a compatibility redirect. The server omits clinical children until a valid facility is selected.

`/account/security` lets the authenticated credential owner verify a recovery email, set up/confirm MFA, and disable MFA with password plus code. MFA changes revoke existing sessions in the same transaction. `/forgot-password`, `/reset-password` and `/verify-email` implement verified-email recovery. Migration 0034 adds email verification state and one-use, 20-minute recovery requests. Reset requests use non-enumerating responses and independent persisted SMTP delivery. Token hashes authorize confirmation; outbound tokens are encrypted in storage and travel in link fragments rather than server request URLs. Password reset is transactional with session revocation and keeps enabled MFA intact. Email verification requires the requesting staff account's session.

The project Docker Mailhog inbox on 8026/SMTP 1026 captures development mail without external delivery. Pending mail is retried after service errors/restarts. Production requires configured SMTP with TLS, a stable private mail encryption key, and the actual public web origin; no default encryption key is supplied. No old staff passwords or MFA secrets were changed by the synthetic verification runs.

Evidence: API unit regression **283 passed**, HTTP regression **105 passed**, API-client **11 passed**, web session security **6 passed**; API/web production builds, lint/typecheck, boundaries and secret checks passed. The recovery smoke covers unknown/unverified requests, wrong-owner email verification, mail delivery, expired links, concurrent single-use reset, old-session rejection and new-password login. Chrome covers the redesigned login, compact dashboard popup, header switching between two facilities with updated roles, opt-in MFA setup from settings, subsequent MFA challenge/retry and no-membership recovery. Test helpers clean their own recovery records as well as synthetic credentials. Screenshots remain local ignored evidence under `tmp/w02-evidence/`.

## W03 entry and release limits

Before patient wiring, verify patient/object/facility ownership, canonical privileges, privacy/consent, actor provenance and registration transaction/outbox/audit consistency with negative real-HTTP tests. Implement patient read/search/detail projections and registration idempotency before building against them. Missing DATA-001 and clinical/QA ownership remain in the plan.

Nonce-based CSP, deployment secret/proxy/HTTPS verification, shared-workstation policy and the full accessibility/supported-device matrix remain production acceptance work. This is not a production release or clinical safety sign-off.
## Staff inbox foundation follow-up — 2026-10-14

Implemented a header bell and full notification inbox backed by current staff membership and facility scope. Migration 0035 adds per-recipient read state and an independent durable delivery checkpoint. Nonclinical task assignment commits its task, event and authenticated actor audit in one transaction; five-second in-app delivery is replay-safe and independent of global outbox publication. Visible clients poll every 30 seconds and refresh on focus/read updates.

Evidence: five real database/HTTP tests; Chrome smoke proves event → worker → BFF → bell/inbox → task detail, unread filtering, read without completion, single-facility header, mobile layout and outage recovery. Existing 283 backend unit, 105 HTTP and 11 API-client regressions pass; API/web production builds, lint, type checks, boundaries and secrets checks pass. Persistent local Docker database migrated through 0035; synthetic notification test records are confined to disposable verification.

Scope and remaining work: [STAFF_NOTIFICATIONS_REVIEW.md](../STAFF_NOTIFICATIONS_REVIEW.md). This does not complete critical-result escalation, department/team routing, clinical event subscriptions, task actions, preferences or external delivery channels. Local demo role accounts remain without task-assignment privileges.

## Personal security settings presentation — 2026-10-14

Follow-up: security forms now open in a modal right-side drawer on desktop and a rounded bottom drawer at mobile widths. Native dialog focus containment, initial input focus, Escape/close/cancel dismissal, focus restoration and background scroll locking are implemented. Feedback stays inside the drawer. The focused browser test verifies desktop/right and mobile/bottom positioning alongside the existing account actions.

Account security now uses a personal-settings layout with signed-in identity, a security section, MFA/recovery status and compact setting rows. Sensitive forms open explicitly through Set up/Manage/Add email/Change; cancelling clears entered secrets and returns focus. Verification-request feedback does not imply that an email is verified. MFA enrolment and email changes retain the existing password/authenticator checks.

Focused Chrome proof: settings start collapsed; editor focus, rejected password confirmation, actual authenticator setup, cancellation, recovery-email verification request and mobile width pass. Web lint and type checks pass. Test runner: `apps/web-clinical/tests/account-settings-smoke.mjs`, using the disposable database and isolated 3048/3018 servers described in the local runbook. Screenshots are in ignored `tmp/security-evidence`.

