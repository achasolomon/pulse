# Pulse clinical frontend

When reviewing a production build alongside `next dev`, set `PULSE_NEXT_DIST_DIR=tmp/login-review-build` for both build and start. This keeps generated assets separate from development's `.next` output. Next may add the review types path to `tsconfig.json` during build; remove that temporary include after review. The expanded browser smoke covers six login attempts and waits for the existing five-attempts-per-minute throttle window before its final MFA retry.

W02 implements staff login/MFA, encrypted session transport, authorized facility selection and actual staff context. Clinical workflows follow the [frontend plan](../../docs/FRONTEND_DELIVERY_PLAN.md). Brand samples establish direction and quality rather than final designs.

Copy `.env.example` to an ignored `.env.local`. Set `PULSE_API_BASE_URL` including `/api/v1`, a separately generated high-entropy `PULSE_SESSION_SECRET` (at least 32 characters), and `PULSE_APP_ORIGIN` to the public origin including scheme/port. Generate a key with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`; keep it out of source control. Node and Edge need the same key. Production uses HTTPS/Secure cookies. The API needs migrated PostgreSQL and an active person credential/facility membership; missing memberships show guidance instead of demo access.

```powershell
pnpm --filter web-clinical dev   # port 3001
pnpm --filter web-clinical test
pnpm --filter web-clinical typecheck
pnpm --filter web-clinical lint
pnpm --filter web-clinical build
```

Node 24 runs the native cookie/Origin tests. Backend tokens never reach browser JavaScript; session and membership are verified on protected reads. Backend failures are unavailable states; failed revocation leaves sign-out retryable. See [ADR-008](../../docs/ADRs/ADR-008-staff-web-session.md).

For isolated live checks, build both apps, migrate a disposable local PostgreSQL database at `127.0.0.1:5437/pulse`, start the API on 3047 with that `DATABASE_URL`, and start the frontend on 3017 with `PULSE_API_BASE_URL=http://127.0.0.1:3047/api/v1` and `PULSE_APP_ORIGIN=http://localhost:3017`. From repository root:

```powershell
$env:PULSE_DISPOSABLE_DB='yes'
# DATABASE_URL must also be set to your disposable database connection string.
node apps/web-clinical/tests/live-auth-smoke.mjs
node apps/web-clinical/tests/browser-auth-smoke.mjs
node apps/web-clinical/tests/outage-auth-smoke.mjs
```

Runners refuse other DB hosts/ports/names, create synthetic fixtures and clean their own rows. The browser runner uses installed Chrome (`PULSE_BROWSER` can override it), recording ignored screenshots under `tmp/w02-evidence`. The outage runner pauses after login: stop only the temporary API, then press Enter; keep PostgreSQL running for fixture cleanup. Run only against disposable infrastructure. Deployment, clinical safety and complete accessibility acceptance remain separate.
