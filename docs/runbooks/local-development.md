# Persistent local development and UI role accounts

Account recovery and MFA: start the project inbox with `docker compose -f infra/docker-compose.yml up -d mailhog`. Development messages appear at `http://localhost:8026` (SMTP `127.0.0.1:1026`). Configure the SMTP fields from `apps/api/.env.example`, and generate `STAFF_RECOVERY_MAIL_KEY` with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, saving it only in the ignored API `.env`. Apply migration 0034 before using account security. The local environment has these settings configured.

Sign in, choose a facility from the dashboard popup/header, and open **Account security** to enable MFA or add a recovery email. Open the verification email's link while signed in to that same account. A verified email is required for **Forgot password?** reset links. Development email is captured by Mailhog rather than delivered to external inboxes. MFA becomes the second login step only after setup/code confirmation. Enabling/disabling MFA and resetting a password sign out existing sessions. SSO is excluded from the current product by user decision.

PostgreSQL runs in the project-owned Docker Compose service `postgres`, container `pulse-postgres`, with named volume `infra_pulse-pgdata`. Its default host binding is `127.0.0.1:5436`; `PULSE_POSTGRES_PORT` can override it. The separate database already running on 5432 belongs to another project. Do not remove the named volume when restarting the local environment.

```powershell
docker compose -f infra/docker-compose.yml up -d postgres
```

Copy `apps/api/.env.example` to ignored `apps/api/.env`, setting `PGPASSWORD` to the local Compose database password (`pulse` for the supplied development service). The URL contains only the database username/host; node-postgres reads its password from `PGPASSWORD`. The API runs on 3000; the frontend runs on 3001 with `PULSE_API_BASE_URL=http://localhost:3000/api/v1`. Set `DATABASE_URL` and `PGPASSWORD` in the terminal for migration/seed scripts; the API loads its own local environment at startup.

```powershell
node scripts/db-migrate.mjs
$env:PULSE_SEED_LOCAL_ROLES='yes'
node scripts/seed-local-role-accounts.mjs
pnpm --filter api dev
pnpm --filter web-clinical dev
```

The role seed requires the local Docker connection on loopback port 5436/database `pulse` and refuses production mode. Build the API first if its compiled credential helpers are absent (`pnpm --filter api build`). The seed is repeatable and refuses to overwrite credentials it did not create. It creates nine active staff-role accounts and a no-membership account. Generated credentials are kept in ignored `tmp/local-role-credentials.json`; no plaintext staff passwords are committed.

| Login | Presentation role | Facilities |
|---|---|---|
| demo.admin | administrator | City General Hospital (Demo), Riverside Clinic (Demo) |
| demo.doctor | doctor | Both demo facilities |
| demo.nurse | nurse | City General Hospital (Demo) |
| demo.reception | receptionist | City General Hospital (Demo) |
| demo.records | records officer | City General Hospital (Demo) |
| demo.pharmacy | pharmacist | City General Hospital (Demo) |
| demo.lab | lab_technician | City General Hospital (Demo) |
| demo.radiology | radiologist | City General Hospital (Demo) |
| demo.cashier | cashier | City General Hospital (Demo) |
| demo.noaccess | No membership | None; exercises access guidance and sign-out |

These accounts test current authentication, facility selection and role presentation. They have no clinical/administrative action privileges: this is not the approved production RBAC matrix. Role-specific clinical workspaces and privilege policy are still being implemented. Use only synthetic records. The existing login throttle permits five attempts per minute, including MFA attempts; allow the window to reset when switching through many accounts.

Health verification: `GET http://localhost:3000/api/v1/health/ready` must show the database as up, rather than not-configured. Credentials and memberships persist in the Docker volume across API/container restarts. Disposable W02 integration databases on 5437 remain separate from this development environment.
## Staff notification inbox

Apply migrations through `0035_staff_notification_inbox.sql`. Database-backed development/production API instances run the in-app delivery consumer automatically; `NODE_ENV=test` leaves timer execution to the test harness. No email/SMS provider is needed for this first in-app slice.

Staff select a facility, then use the header bell or `/notifications`. Local role-demo accounts have no task-assignment privilege by default; do not add clinical privileges just to display a badge. A user with an actual `task:create` membership can call `POST /api/v1/workflow/staff/tasks` with `kind` and an active same-facility staff `assigneeId`, authenticated bearer token and matching `x-tenant-id`/`x-facility-id`. The resulting nonclinical task event is consumed within the normal five-second worker cadence; visible inbox clients refresh every 30 seconds or on focus. The UI does not yet include a task-assignment form.

Verification uses the disposable PostgreSQL database on port 5437 and isolated API/web servers on 3048/3018. Run `apps/web-clinical/tests/notification-smoke.mjs` with `PULSE_DISPOSABLE_DB=yes`, the disposable `DATABASE_URL`, and `PGPASSWORD` configured. Synthetic tasks/accounts are cleaned after the browser run. Screenshots go to ignored `tmp/notification-evidence`.

## Patient frontend read slice

Apply migrations through 0036. `/patients` appears for a selected-facility membership with `patient:read`; `/patients/[id]` also needs an active care assignment or explicitly granted `care:unrestricted`. Clinical sections separately require `observation:read` and `entry:read`. Automated verification still uses disposable records only.

For reviewing the screens in the normal local app, `scripts/seed-local-patient-preview.mjs` is explicitly enabled with `PULSE_SEED_LOCAL_PATIENTS=yes` and a localhost-only DATABASE_URL on port 5436. It grants explicit local demo registration/check-in/vitals/consultation permissions and care assignments to six clearly labelled Demo patients. It never grants unrestricted care and does not change passwords or MFA. Each demo hospital has three preview patients. This is local UI preview data, not a production role policy. Refresh the page after applying.

## Outpatient role workflow

Clinical documentation follow-up (2026-10-15): apply migrations through 0038 and rerun the local patient-preview seed. Nurses/consultation staff use **Clinical notes → New note**, then **Save draft** or **Review & sign**. Own unsigned notes offer **Edit draft**; own signed notes offer **Add addendum**. A doctor must start their assigned consultation first. Nurses can document their assigned visit after handoff while the encounter remains active. Signing preserves the note and does not discharge the patient. `tests/clinical-notes-smoke.mjs` exercises the lifecycle against disposable PostgreSQL on 5437 and API/web 3048/3018; screenshots are saved to ignored `tmp/clinical-notes-evidence`.

Patient record redesign (2026-10-15): open a patient chart to use Overview, Visits & encounters, Vitals history, Clinical notes, Problems & allergies, Medications & treatment, Investigations, Documents and Patient details. Historic encounters support links to visit-specific vitals/notes/treatment. Re-run the local preview seed to enable the new read capabilities for demo admin/doctor/nurse. The chart shows actual saved records; the seed does not add fabricated past treatment to the normal database. For populated visual verification, `tests/patient-record-smoke.mjs` uses disposable PostgreSQL on 5437 and the isolated API/web on 3048/3018, saving screenshots in ignored `tmp/patient-record-evidence` and cleaning its fixtures afterwards.

Apply migrations through 0037 and run both local role and patient-preview seeds above. Use **City General Hospital (Demo)** for the four-role walkthrough; records, reception and nurse accounts belong to this hospital. All role accounts reuse the generated password in ignored `tmp/local-role-credentials.json`.

- `demo.records`: Patients → Register patient → Check in → Confirm check-in to send the new patient for vitals. Check possible duplicates before explicitly creating a separate record.
- `demo.reception`: Patients → Find the record → Check in → Confirm check-in. The visit enters the nurse queue.
- `demo.nurse`: Staff worklists → Vitals → Start vitals → Save vitals. Open chart to see persisted values; Send to consultation selects the receiving clinician.
- `demo.doctor`: Staff worklists → Consultations → Start consultation. The assigned chart opens with its active visit stage.

Nurse and consultation queues can be empty until check-in/handoff occurs. Newly registered patients gain nursing/clinician care assignments through claim/handoff, rather than unrestricted chart access. Consultation notes/orders and visit closure are not delivered by this intake slice. Clinical handoffs currently appear in worklists; the header inbox's nonclinical task delivery does not yet include them.

Run `apps/web-clinical/tests/outpatient-smoke.mjs` with the disposable port-5437 database, `PULSE_DISPOSABLE_DB=yes`, `PGPASSWORD` and the isolated API/web on 3048/3018. It performs the four-role flow against actual HTTP/BFF/UI and removes its scoped fixtures afterwards. Screenshots are saved under ignored `tmp/outpatient-evidence`. Backend workflow checks are in `apps/api/test/outpatient-flow.integration-spec.ts`.

Run `apps/web-clinical/tests/patient-smoke.mjs` against disposable PostgreSQL port 5437 with `PULSE_DISPOSABLE_DB=yes`, `DATABASE_URL` and `PGPASSWORD`, using the isolated API/web on 3048/3018. It creates scoped synthetic patients/assignments and removes them after verification. Read-only UI screenshots are saved under ignored `tmp/patient-evidence`. Backend scope tests are in `apps/api/test/staff-patient-read.integration-spec.ts`.


Laboratory order follow-up (2026-10-15): apply migrations through 0044. With the existing local role demo organization in place, set `PULSE_SEED_LOCAL_LAB=yes` and the local port-5436 `DATABASE_URL`, then run `node scripts/seed-local-lab-catalogue.mjs`. This exposes two labelled preview catalogue choices at the local demo facilities and enables demo doctor/admin laboratory order/cancel capabilities; it creates no clinical orders. Their specimen text is a demo placeholder, not approved collection guidance.

As `demo.doctor`, start the assigned consultation, open **Patient → Investigations → Order laboratory test**, choose a test, record indication/urgency and explicitly review before placing. **Review laboratory order** shows the saved request and offers reasoned cancellation before collection starts. Notes and this order slice supersede the earlier intake-only limitations above; encounter closure, collection/accession, laboratory worklists, result acknowledgment and clinical notification routing remain pending. `apps/web-clinical/tests/clinical-lab-orders-smoke.mjs` checks the workflow against isolated 3048/3018 services and disposable PostgreSQL 5437 only, cleaning its synthetic orders afterward. See `docs/sprints/SPRINT_W06.md` for scope and evidence.

Laboratory specimen follow-up (2026-10-15): apply migrations through 0046 and rerun the opt-in local lab catalogue seed above. Sign in as **demo.lab** with the existing local demo password and select City General Hospital (Demo). **Staff worklists → Laboratory → Review request** records collection, then receipt/accession, in desktop side/mobile bottom drawers. A doctor must place an order before the queue has work; no clinical orders/specimens are seeded into the normal database. This account gains laboratory duty capabilities without unrestricted chart care. The first workflow supports one specimen per order and manual labels; rejection/recollection, label printing, custody corrections and result entry/verification remain pending. `apps/web-clinical/tests/lab-specimen-workflow-smoke.mjs` exercises isolated disposable 5437/3048/3018 services and cleans its fixtures.

Laboratory results follow-up (2026-10-16): apply migrations through **0047**, then rerun the same opt-in local catalogue seed. As **demo.lab**, open an accessioned request, enter each component with its actual measurement time, review and save for verification. As **demo.admin**, select the same facility, open **Staff worklists → Laboratory → Awaiting verification**, review the report and explicitly verify/publish. The author cannot verify their own findings. Existing demo passwords are unchanged. Only verified findings appear in the clinical chart; critical findings remain held pending accountable electronic notification/acknowledgement, with direct facility escalation required. No automatic reference intervals or panel completeness checks are implied. `apps/web-clinical/tests/lab-result-workflow-smoke.mjs` tests this flow on disposable services 5437/3048/3018, removing its synthetic records afterward.

Critical communication follow-up (2026-10-22): apply migrations through **0049** and rerun the opt-in lab catalogue seed. Record a critical component as **demo.lab**. As **demo.admin**, review the request, independently confirm it, select **demo.doctor** (who must have current care responsibility), and set a facility-policy follow-up deadline. Record actual failed or successful phone/in-person attempts; successful contact requires read-back. As **demo.doctor**, use the header **Critical follow-up** link, review the finding and explicitly acknowledge it. As **demo.admin**, return to the request and perform final verification/publication. Opening the finding does not acknowledge it, and acknowledgement does not publish it. Existing passwords are unchanged. Cases remain unresolved after encounter closure; care/membership revocation still applies. This supersedes the earlier blanket critical hold for this manual path only. Backup/reassignment/timed escalation and external notification delivery remain pending; use the facility's direct escalation procedure. `apps/web-clinical/tests/critical-result-workflow-smoke.mjs` verifies the disposable 5437/3048/3018 workflow and cleans its fixtures.

Backup routing follow-up: apply migrations through **0050**. As an authorised verifier (local **demo.admin**), open a pending critical finding and expand **Cover & escalation → Add covering clinician**. Select another clinician who already has current patient care responsibility and acknowledgement permission, choose immediate cover or the existing follow-up deadline, record a reason and review/confirm. The original assignment is preserved. No new clinician accounts or care relationships are seeded. If no additional eligible clinician exists, the UI explains that access/responsibility must first be reconciled; it does not grant access automatically. Scheduled backups activate through the running API's five-second durable worker; withdrawn access results in visible blocking, not silent reassignment. Record actual contact/read-back for the selected covering recipient before they explicitly acknowledge. The original clinician's read-back is insufficient for the backup. Acknowledgement cancels remaining scheduled activation. External messages and facility-wide escalation policy management remain pending. Run `critical-backup-workflow-smoke.mjs` only with disposable PostgreSQL 5437 and isolated services 3048/3018; run the API integration suite before starting the live review worker.

Imaging requests follow-up (2026-10-22): apply migrations through **0051**. With normal localhost PostgreSQL 5436/pulse, set `PULSE_SEED_LOCAL_IMAGING=yes` and run `node scripts/seed-local-imaging-catalogue.mjs` with `DATABASE_URL` configured. The guarded opt-in script adds demo chest/knee X-ray catalogue mappings and imaging capabilities for **demo.doctor/demo.admin**, without clinical orders or care assignments. Sign in again to refresh capabilities. As the assigned treating clinician, start the consultation and open **Patient → Investigations → Request imaging**. Select a procedure, choose a side when required, record indication/urgency and review/attest. **Review imaging request** permits reasoned cancellation before processing. Existing passwords are unchanged. Safety context does not complete radiology screening or approve protocol/contrast/exposure. These are demo catalogue placeholders requiring approved clinical configuration. Radiology worklist, screening/protocol, acquisition/reporting and PACS integration remain pending. `clinical-imaging-orders-smoke.mjs` uses disposable 5437 and isolated 3048/3018 services, cleaning its synthetic fixtures.
