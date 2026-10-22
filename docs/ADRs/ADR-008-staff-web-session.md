# ADR-008: Staff web session and context bootstrap

Date: 2026-10-14. Status: accepted for the W02 development foundation; production security acceptance remains separate.

## Decision

Keep backend `iam.session` authoritative for staff identity, absolute expiry and revocation. The Next BFF uses a versioned AES-GCM encrypted authenticated `HttpOnly` cookie containing the opaque backend token, session ID, bounded expiry and selected facility ID. It contains no credentials, clinical records or browser-supplied privileges, and replaces unsigned JSON.

A separate BFF database is unnecessary for this slice: protected renders and BFF reads verify the backend session through authenticated `GET /iam/auth/me`. Middleware performs cryptographic/expiry admission only. Browser responses contain server-derived identity, current memberships and presentation capabilities, never the bearer token. API authorization independently checks membership and the actual organization/facility relationship.

The cookie uses a fresh 96-bit nonce, AES-256-GCM and version-specific authenticated additional data. Generate a high-entropy `PULSE_SESSION_SECRET` independently per environment (values shorter than 32 characters are rejected), distribute it consistently to Node and Edge, and keep it out of source control. There is no development fallback. Rotation invalidates cookies and requires sign-in; it does not itself revoke backend sessions. No rolling extension or refresh token is introduced. Facility switching caps expiry to the backend expiry and performs full navigation to discard previous client state.

## Failure and deployment behavior

- Invalid, tampered, unsigned, expired, revoked or disabled sessions cannot render the protected workspace. Login remains reachable to avoid redirect loops.
- Backend failure is unavailable, not an empty membership list or automatic logout. Sign-out retains the encrypted cookie on revocation service failure and displays a retry error; success requires revocation or confirmation that the session is already invalid.
- Failed context bootstrap after login attempts revocation. If the backend is unavailable, its eight-hour expiry bounds the orphaned session; no usable browser cookie is issued.
- Mutating BFF routes require full same-origin scheme/host/port, plus `SameSite=Lax`. Production cookies use `Secure`. Reverse proxies must configure the actual public HTTPS `PULSE_APP_ORIGIN`.
- Identity/context responses are private and not stored. Tokens never enter browser responses, URLs or browser storage.

## Remaining release work

Before clinical wiring, verify patient/resource authorization, canonical privileges, consent, actor provenance, command/outbox/audit consistency and sensitive cache cleanup with the actual workflow. Before production, verify secret distribution/rotation, HTTPS/proxy handling, nonce-based CSP, shared-workstation timeout policy and the complete supported-browser/accessibility matrix. Recovery, self-service MFA enrollment and federation need their own authorized contracts and flows; the current frontend consumes the existing login MFA challenge only.
