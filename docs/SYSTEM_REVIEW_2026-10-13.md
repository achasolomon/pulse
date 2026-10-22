# Pulse system review — 13 October 2026

Review of the current working tree before further frontend implementation. Delivery plan: [FRONTEND_DELIVERY_PLAN.md](FRONTEND_DELIVERY_PLAN.md).

Planning update: the delivery plan now includes the [full functional scope catalogue](FRONTEND_SCOPE_CATALOGUE.md) and source/screen coverage registers. The user's subsequent clarification is authoritative: brand sample screens establish the expected UI/UX quality and direction, **not final approved designs**. Earlier references in this historical review to a mockup “visual target” mean quality reference only; final layouts follow role workflows and validation.

## Assessment

Pulse has substantial backend breadth and a reusable frontend foundation. The correct next investment is a verified clinical journey supported by a secure session/context layer and screen-oriented read contracts. Retain the existing architecture and branding.

The repository does not provide a defensible denominator for “90% backend complete.” The backend tracker closes almost every epic, but those closures often describe bounded backend slices, while the parent specifications require considerably more. Implementation coverage, frontend usability, integration availability and production acceptance need separate status fields.

Examples: medication commands exist without staff medication read routes or a scheduled-dose engine; imaging viewer access returns a stub; document downloads return a placeholder; central edge identity exists without a deployed edge runtime. These are useful foundations but materially affect the frontend plan.

## Review scope and evidence limits

- Inventoried both applications, all eight package directories, infrastructure, scripts, migrations, tests and documentation.
- Extracted text from all 31 DOCX files. Reviewed the specification catalogue, mandatory invariants, release requirements and frontend-related sections across that corpus; read FE/UX architecture and screen requirements in detail, with focused domain implementation review. This is a repository readiness review, not certification of every requirement or every line of code.
- Reviewed the Markdown trackers, 38 backend sprint records, W01/W02 records, seven ADRs, operating model and runbooks. Inspected all 31 backend domain route surfaces and sampled the services/repositories behind the workflows and risks below.
- Visually inspected all seven source branding images, including both brand boards and the dashboard/workflow mockup.
- Ran the existing unit/component/client/API E2E suites, selected typechecks and lint, boundary and secrets checks, frontend production build and HTTP smoke checks.
- Database-backed integration tests, browser automation, visual screenshots of the running app, keyboard/screen-reader walkthroughs, load tests, production infrastructure, clinical UAT and live third-party adapters were **not** verified in this review. Existing sprint evidence is historical, not a fresh execution of those checks.
- The working tree already contained extensive modified/untracked frontend, UI-kit and API-client work. It was reviewed as the current baseline. No application source or existing tracker was edited for this review. Build/typecheck can regenerate build metadata.

## System architecture

| Area | Current implementation | Implication |
|---|---|---|
| Workspace | pnpm 11.5.0; installed Turbo 2.11.7; apps/packages/infra/scripts | Keep the workspace. Installed Turbo docs were read; no task configuration changed. |
| Backend | NestJS 12, strict TypeScript, modular monolith with domain/application/infrastructure/interface separation | Continue through owned ports and commands; avoid a frontend-driven rewrite. |
| Persistence | PostgreSQL/Kysely; 33 ordered SQL migrations, `0001`–`0033` | Domain schema ownership is visible. Isolation, concurrency and durability still require workflow-level verification. |
| Staff web | Next.js 14.2.35, React 18.3.1, TypeScript; `web-clinical` on port 3001 | Only dashboard and login page routes currently exist, plus three auth BFF routes. |
| Shared UI | Tokens, CSS, accessible primitives, patient banner and icons in `@pulse/ui` | Reuse and harden; extend components in response to real workflow requirements. |
| API client | Typed fetch transport, context headers, cancellation, errors, login/logout | A transport foundation; feature request/response contracts are largely absent. |
| Contracts/events | `api-contracts` contains error/pagination interfaces; `events` contains an envelope | Neither is a complete generated API/event catalogue. |
| Interoperability | FHIR/HL7 handling inside a separate logical backend module | Keep internal UI contracts domain-native; FHIR is the external boundary. |
| Operations | Dockerfile, compose, metrics, security/SRE APIs, backup/cutover scripts and runbooks | Local tooling exists. Production automation and operational sign-off remain separate work. |

Eight shared packages: `api-client`, `api-contracts`, `config`, `events`, `observability`, `terminology`, `testkit` and `ui`.

## Backend-to-screen readiness

Static controller inventory: **31 domains, 288 declared route handlers: 86 GET and 202 command handlers**. This excludes platform health/metrics and counts declarations, not unique deployable services. Route count measures breadth, not completeness.

| Domain | Implemented foundation | Frontend dependency or limitation |
|---|---|---|
| Organization | Organization/facility/department/unit/location creation and lists | No authenticated bootstrap discovery of the actor's organizations/facilities; no general edit/publish configuration lifecycle. |
| IAM | Staff credentials, opaque sessions, TOTP, membership/policy, care assignment, break-glass | No staff `/me`, accessible memberships, capabilities, membership-management or care-assignment HTTP surface. Federation/reset are deferred. |
| Patient | Register, prefix/exact search, summary, duplicates, merge, guarantor | Search fixed at 25 and returns empty identifier arrays. No paginated patient worklist; summary is demographics/identifiers, not full chart overview. |
| Scheduling | Book, check-in/start/complete/cancel/no-show/reschedule, queue | Queue fixed at 50; no day/range/provider schedule or detail GET. Cancellation currently has no reason DTO. |
| Encounter | Open, detail/history, admit/transfer/discharge/cancel, coverage | Active listing exists as an internal port, not a general worklist route. Resource scope must be enforced on reads and transitions. |
| Clinical | Vitals, note creation/sign/addendum, entries, timeline, handover, JSON export | No note GET/update-draft route. No dedicated vitals/allergy/problem detail reads. Timeline contains summaries, not a full editable chart. |
| Laboratory | Catalogue definition, orders, worklist, collection/accession/results/verify/critical acknowledgement/cancel | Need searchable catalogue, order/specimen/result detail and review queue. Reference intervals, rejection/recollection and accountable follow-up need deeper contracts. |
| Imaging | Order/schedule/protocol/acquire/report/finalize/cancel, viewer reference | No staff worklist/detail/report GETs. Viewer is `pacs://studies/...` stub, not a signed contextual PACS launch. |
| Medication | Catalogue write, prescribe/verify/dispense/hold/resume/complete/cancel/administer | **No staff GET handlers.** Need catalogue/verification/dispense/history reads and scheduled-dose model before a full eMAR. CDS, reconciliation and barcode workflows are not proven. |
| Inventory | Catalogue/location commands, receive/issue/reconcile/procure, balance/FEFO | Need item/location/ledger/procurement worklists/details; full transfer, quarantine/recall and approvals cannot be assumed. |
| Revenue | Charge/invoice/payment/adjustment/coverage/claim commands, balances, party outstanding, claim submissions, billing projection | Need account/charge/invoice/payment/claim read screens and receipts; remittance/EDI/cashier closing remain gaps. |
| Insurance | Payer/contract/tariff, eligibility evidence, preauth, benefit commands | **No GET handlers.** Need payer/contract/tariff/preauth/eligibility worklists and details. |
| Workflow | Create/list/complete/escalate tasks, notification recording | No notification-centre list/read HTTP surface or proven external delivery adapter. Static bell count cannot represent backend truth. |
| Documents | Register/list metadata | Detail route returns `signed-url-pending`; no complete upload/quarantine/signed-download lifecycle. |
| Consent | Capture and withdraw | No general consent history/list/read surface for disclosure preview and consent UI. |
| Referral | Inbox, messages, lifecycle commands | Need outgoing list/detail/package/provenance/disclosure reads. Explicit `care-assumed` milestone is absent from the current status model. |
| Reports | Census, revenue, claims | Three baseline reports; executive dashboards, warehouse feeds and regulatory exports are separate scope. |
| Portal | Separate patient auth/proxy and scoped care/account reads | No `web-patient` app; self-booking, messaging and document bytes are deferred. Validate result-release policy before exposing results. |
| Sync/edge | Feed/apply/conflicts, device enrolment/token/status/heartbeat | Central protocol/identity foundation; no browser offline storage or deployed edge-side runtime demonstrated. |
| Security | Events, detections, finding triage | Broad security baseline, not full verification. Patient-read audit coverage and partner read scopes remain gaps. |
| SRE | Alert rules/evaluation, backups/status/evidence | Manual evaluation and logical backup drills; recurring routing, true WAL/PITR and full-stack DR remain deployment work. |
| Emergency | Acuity, waiting queue, disposition | Useful ED slice; complete operational ED workspace requires context, detail and escalation evidence. |
| Theatre | Suite/booking/checklist/procedure lifecycle commands | **No GET handlers.** Schedule/case/checklist history reads required; anaesthesia and implants deferred. |
| Blood bank | Unit testing/release/crossmatch/issue/transfusion commands | **No GET handlers.** Unit/compatibility/crossmatch/transfusion worklists needed before a usable specialist UI. |
| Anatomy | Versioned model/structure/finding reads and draft/sign/amend/error/link commands | Best-developed dedicated UI contract, but assets/licensing, 2D/3D viewer, snapshots/media/measurements and accessibility remain work. |
| Dialysis | Protocol/program/session reads and lifecycle commands | Dedicated frontend absent; encounter linkage and advanced measures remain separately governed. |
| Equipment | Assets/maintenance reads and lifecycle commands | Can support an operations frontend after common auth/context foundation. |
| Roster | Staff/shift/on-call/assignment reads and commands | Roster workforce identity does not replace staff authentication, membership or clinical privileging. |
| Bedflow | Beds/assignments/level-of-care reads and commands | Supports a board foundation; reconciliation with encounter ADT and concurrency needs explicit verification. |
| Research | Studies/cohorts/export approval and pseudonym governance | Cohort criteria are stored artifacts, not an executed query engine; privileged subject vault needs careful administration UX. |

Sources: `apps/api/src/modules/*/interface/*controller.ts`, repository ports and associated services; sprint non-goals/follow-ons establish narrower delivered scope than the parent specifications.

## Findings that affect delivery

Priority: **P0** before real patient-data wiring; **P1** before the affected workflow is accepted; **P2** before broad rollout or operational release. Source findings are distinguished from runtime observations.

### R01 — Resource scope is not derived consistently from the protected object (P0)

`TenantContextGuard` validates header shapes but does not verify the selected tenant owns the facility. `AuthorizationGuard` resolves membership for the header facility, then evaluates `{ ...membership, facilityId }`, and care-relationship narrowing depends on an optional `x-patient-id` header. Patient search accepts an independent query facility. Patient and encounter detail repositories read by ID without an authorized facility predicate. Clinical creation passes patient and encounter independently without validating they match.

Further, the policy's chart-resource set uses names such as `clinical.note` and `scheduling.appointment`, while controllers require `note`, `observation`, `entry`, `appointment`, `document` and `handover`. Some clinically sensitive actions therefore do not enter the intended care-relationship branch even with a patient header.

These are source-confirmed enforcement gaps, not a live cross-facility penetration-test result. Fix server-derived object ownership, tenant/facility membership binding, mandatory resource/patient consistency and canonical privilege names. Browser headers cannot be the security control. Verify using real staff sessions against two organizations/facilities and two patients, including omitted and misleading context headers.

Sources: `platform/common/guards/tenant-context.guard.ts`; `modules/iam/interface/authorization.guard.ts`; `modules/iam/domain/policy.ts`; patient, encounter and clinical controllers/repositories.

### R02 — Frontend session gate trusts cookie presence and unsigned metadata (P0)

`middleware.ts` treats any `pulse_session` cookie as authenticated. `session.ts` stores token and identity in unsigned base64 JSON. The app layout does not redirect when decoding fails, and `/api/auth/session` only decodes the cookie without checking backend session validity.

Production HTTP smoke on temporary port 3017 confirmed:

| Request | Result |
|---|---|
| `/` without cookie | 307 to `/login` |
| `/login` without cookie | 200 |
| `/` with malformed cookie | **200, mock dashboard rendered** |
| `/login` with malformed cookie | **307 to `/`**, blocking straightforward sign-in recovery |
| `/api/auth/session` with malformed cookie | 401 |
| `/` and session endpoint with synthetic unsigned metadata/invalid token | **200, synthetic identity accepted** |

This does not demonstrate that an invalid token can read real backend PHI: the dashboard is static and backend token verification remains separate. It does show a false authenticated state and unsafe future integration baseline. Prefer an opaque BFF session identifier backed by a server session store, or a vetted authenticated cookie design, with backend revocation/expiry checks and explicit cache clearing. Do not treat `HttpOnly` as payload integrity protection.

### R03 — Outbox availability does not guarantee atomic clinical writes (P0 for first clinical commands)

`OutboxService.publish` accepts a transaction, but inspected note, encounter, imaging and medication paths write domain state and then publish in separate operations. For example, `ClinicalService.draftNote` creates a note before inserting its event. Event failure can leave committed state behind a failed command response. Medication dispense writes dispense, status and event separately.

The relay is still a claim/mark skeleton, without a broker publish loop. Its row locks are not held across a claim→publish→mark transaction. Billing projection peeks unpublished events, which also requires a durable consumption contract before a relay can mark events and make them unavailable to that projector.

Adopt transaction-owned command execution, same-transaction outbox insertion, safe consumer checkpoints and failure-injection verification before relying on these paths for durable UI outcomes.

### R04 — Retry and concurrency support is uneven (P1)

FHIR external ingestion has idempotency and anatomy drafts use expected versions. They are not a platform-wide guarantee. Many staff commands use read→validate→update with no expected-version condition or durable command key. A disabled submit button cannot prevent duplicate commands from retries, multiple tabs or unknown network outcomes.

Define idempotency and version rules per consequential command, starting with registration, encounter creation, note signing, orders, dispense/administer, payments and referral transitions. Clinical note signing has a conditional draft update; ensure a concurrent loser maps to a safe domain conflict rather than an unhandled error.

### R05 — Provenance and read audit are incomplete (P1)

The generic `AuditInterceptor` records successful decorated actions asynchronously without awaited persistence and without resolved actor/resource identifiers. Many sensitive reads lack `@Audited`. Clinical note DTO/controller do not bind author to the authenticated actor; the repository accepts a nullable author. Timeline summaries omit resource IDs and detailed provenance needed for drill-through.

Bind actor identity server-side, make required audit durable, audit scoped reads/exports according to policy, and return effective/recorded/signed times plus source in clinical read contracts. Existing security event recording is useful but does not replace authoritative patient-access audit.

### R06 — Missing reads and contracts will otherwise force mock production screens (P1)

Commands often outnumber screen-oriented reads. `api-contracts` has only two generic types; `api-client` hand-types auth only; there is no checked-in OpenAPI artifact. Need paginated worklists, resource detail, chart projections and catalogue searches in owning modules. Avoid fetching a whole chart, using exports as normal reads, or substituting patient portal endpoints for staff APIs.

The error specification itself contains both a nested standard example and a ProblemDetails appendix. Existing backend uses flat ProblemDetails. Record that concrete choice and unify types; map actual stable codes and field paths. Current validation errors are grouped under `validation`, so inline field mapping is not yet a complete contract.

### R07 — Foundation UI conveys unverified operational truth (P1)

Dashboard doctor, facility, patient rows, counts and critical alerts are fixtures. All global navigation/action links are `#`; active navigation is fixed to Dashboard. Search/shortcut, notifications and tabs lack functional behavior. Shell says “central sync healthy” unconditionally. The live session login ID does not match the mock dashboard greeting.

Move fixtures into explicitly marked training/demo surfaces. Wire identity/context and truthful availability before clinical use. Separate browser connectivity, API reachability and edge synchronization. Failure must render unavailable/stale, not zero results or green healthy status.

### R08 — Brand fidelity is established; accessibility needs correction (P1)

The palette and fonts match the guidelines board. Production HTML contains the generated teal/sage tokens and self-hosted fonts. However, small status text uses raw semantic foreground colors on pale tinted surfaces. Calculated sRGB contrast from current CSS is approximately **2.89:1 success, 4.37:1 info, 4.01:1 error**. These fall below 4.5:1 for normal text, the acceptance threshold to apply under UX-001's WCAG AA-aligned target; retaining icon and label does not fix low contrast.

Use darker semantic text tokens while preserving the brand colors for accents. Audit all states. The login references undefined `--pulse-bg` and `--pulse-font-heading`; use the defined background/secondary-font tokens. Mobile drawer lacks focus containment, Escape handling and focus restoration; the patient banner CSS is not sticky despite persistence requirements. Modal focus tests are a starting point, not complete browser accessibility acceptance.

### R09 — Production configuration and CI evidence need an explicit baseline (P1/P2)

No `.github` workflow directory is present in this checkout, despite tracker language about a clean CI pipeline. The backend has no `typecheck` package script; root typecheck can omit API even though `nest build` checks it. `web-clinical` test script reports “no tests yet.” Boundary checks scan backend imports, not frontend features or all cross-schema writes.

`validateEnvironment` returns config unchanged and is not wired into the shown ConfigModule setup. `ALLOW_DEMO_AUTH=true` is not explicitly prohibited in production. The FHIR no-DB development key path is environment-dependent. Browser security headers are not configured in `next.config.mjs`; API Helmet does not protect the separate web app. CSRF comparison checks host rather than full origin and permits missing Origin. API CORS uses default enablement.

Define fail-closed production config, origin/proxy policy, web CSP/cache/headers, reliable CI and an isolated test environment. Existing sprint SCA findings require a fresh dependency/security assessment before release; this review does not assert current vulnerability status.

## Branding conclusions

Preserve the guidelines board as the exact palette reference:

| Token | Value | Intended use |
|---|---|---|
| Deep teal | `#075E54` | Brand anchors, shell, primary emphasis |
| Clinical teal | `#0B7A6B` | Active interactions |
| Sage | `#7FAF9B` | Secondary accents |
| Soft sage | `#DCEBE4` | Subtle grouping/surfaces |
| Background / surface | `#F4F8F6` / `#FFFFFE` | App canvas / primary surface |
| Ink / slate | `#162522` / `#60706C` | Primary / secondary text |
| Success / warning / error / info | `#16A344` / `#F59E0B` / `#DC2626` / `#2563EB` | Semantic accents; derive contrast-safe foreground variants |

Inter is the body/data font; Plus Jakarta Sans is the heading font. Use restrained headings, tabular figures for measurements/money, calm white/sage surfaces, teal navigation and outline icons. The main tagline is **“Connected Care. Healthier Communities.”** Use the full wording on appropriate brand/auth surfaces; the abbreviated compact-shell wording can be documented.

The source art includes materially different emblem treatments and marketing/background variants. Select a canonical logo and record approved horizontal/stacked/reversed/monochrome/icon exports, aspect ratios, padding and minimum sizes. Keep source boards; derive optimized production assets without substituting new branding. Boards illustrate Pulse Clinical, Connect, Patient, Insights and Edge, but their accent colors should not change clinical severity meanings.

The mockup is a visual target, not an authoritative feature contract. It shows SSO/Smart Card, patient photography, a rich note editor, anatomy renderer and imaging viewer that are not all available. Do not advertise those as functional. Its Malaysian names/date/city examples are visual fixtures; use configured Nigerian facility/currency/timezone conventions without hardcoded clinical assumptions. No patient photo without governed consent/storage policy.

## Documentation reconciliation

| Item | Finding | Recommended correction |
|---|---|---|
| `DEV_PHASES.md` | R0 in progress/R1–R6 not started, contradicting backend tracker | Separate implemented backend milestones from end-to-end release acceptance. |
| `BACKLOG_TRACKER.md` | Nearly all epics Done, but vertical-slice exit checklist entirely unchecked | Preserve historic evidence; add UI/API/integration/UAT acceptance and explicit follow-on owners. |
| `UI_TRACKER.md` | W01 Done; W02 Pending while W02 sprint/code are in progress | Reconcile at planning; do not mark W02 Done from file presence. |
| `SPRINT_W01.md` | Foundation evidence useful; claims broad accessibility/live clock | Clarify component-test versus browser acceptance; dashboard time is request-rendered, not a ticking clock. |
| README files | Web/UI/infra descriptions describe Sprint 01; API README is Nest starter | Replace with current setup, security/context contracts and verification instructions. |
| Duplicate DOCX | BACKLOG-MASTER and BACKLOG-001 extracted text identical; MED and REF `(1)` copies identical | Mark canonical files; retain archive/provenance rather than deleting casually. |
| Missing parent | `PULSE-DATA-001` repeatedly referenced but not present as a standalone file | Locate or document the authoritative substitute before data/contract reinterpretation. |
| CR/ADR history | CR-001 remains assessment-for-review; accepted ADR and later sprints implemented it | Mark historical supersession and link accepted decisions/current code. |
| UI scope | Tracker defers billing/referral/inventory/portal/anatomy to unspecified future work | Use the complete delivery waves in the linked plan; retain UX screen IDs and dependencies. |

## Verification performed

| Check | Fresh result |
|---|---|
| `pnpm --filter api test` | **270/270**, 56 files |
| `pnpm --filter api test:e2e` | **105/105**, 2 files; API HTTP/guard tests, not browser E2E |
| `pnpm --filter @pulse/ui test` | **19/19**, 2 files |
| `pnpm --filter @pulse/api-client test` | **9/9**, 1 file |
| Selected typechecks | web-clinical, api-client and ui completed without diagnostic output |
| Selected lint | web-clinical, api-client, ui and API completed without diagnostic output |
| `node scripts/check-boundaries.mjs` | Pass; 229 backend files scanned |
| `node scripts/check-secrets.mjs` | Pass |
| Frontend production build | Pass; `/` dynamic, `/login` static; first-load JS approximately 89.9/91.1 kB |
| Production HTTP smoke | Tokens/login/redirects checked; malformed/synthetic session findings reproduced above |

Vitest initially hit Windows sandbox `spawn EPERM`; the same suites ran successfully with authorized sandbox escalation. API E2E emitted pre-existing no-database SASL errors during the portal abuse test but passed; these errors are documented in Sprint 25 and should be cleaned up as test-environment work. Docker inspection found a running Pulse review/development database alongside unrelated services; no integration suite was run against those existing databases. The temporary web server was stopped after smoke checks.

## Recommended next move

Start with W02 completion expanded to trustworthy session validation, actor/facility/capability discovery and context-safe routing. In parallel as a workstream, resolve backend resource-scope/provenance/transaction requirements for the first outpatient slice. Then implement W03–W05 with the laboratory-order sub-slice required by the master backlog. Accept that journey with real staff sessions, database-backed negative cases and browser/clinical walkthrough evidence before expanding the departmental screen catalogue.
