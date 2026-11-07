# UI Phase Tracker

The first staff notification slice is implemented: scoped inbox, durable nonclinical task-assignment delivery, header bell and full inbox. The [notification review and delivery plan](STAFF_NOTIFICATIONS_REVIEW.md) records evidence and remaining clinical routing/escalation work. The historical backend F15.2 completion covers records/outbox; it does not imply that all notification channels or critical clinical workflows are complete.

Frontend delivery tracker for the Pulse platform. Full proposed roadmap: [FRONTEND_DELIVERY_PLAN.md](FRONTEND_DELIVERY_PLAN.md), with the [complete functional scope catalogue](FRONTEND_SCOPE_CATALOGUE.md) and [87-screen UX mapping](FRONTEND_UX_SCREEN_MAP.csv). The W01–W10 rows below are the initial implementation tracker, not the full product scope. Planning additions do not change their completion status. Brand samples establish expected quality and visual direction; they are not final designs.

Authoritative specs:

- **UX-001** — Enterprise UI/UX Design System, Clinical Interaction Standards & Role-Based Screen Catalogue (design tokens, shell, states, accessibility, per-role screen catalogue)
- **FE-001** — Frontend engineering standards (repo layout, feature architecture, API client, state categories, testing)
- **brand/** — Pulse brand system boards (palette, typography, logo lockups, dashboard mockup = visual target)
- Supporting: IAM-001 (server-side authz; UI never grants), CLIN-001 (status not by colour alone), PRIV-001, QA-001, SAFE-001

Conventions (same discipline as backend sprints):

- Each sprint: `docs/sprints/SPRINT_WXX.md` → implement → tests → gates (typecheck, oxlint, test, build, boundaries) → live/demo proof → close doc → flip row here.
- Every user-facing surface implements loading / empty / error / conflict states (FE-001 §25–29) and accessibility per UX-001 §30 (no colour-only status; keyboard; focus; landmarks).
- Server remains authoritative: UI suppresses unauthorized actions for clarity but never for security (IAM-001).

| ID | Title | Spec | Status | Sprint | Evidence / notes |
|----|-------|------|--------|--------|------------------|
| W01 | Design-system foundation + brand shell | UX-001 §4–§34, FE-001 §4–§19, brand/ | Done | SPRINT_W01 | full tokens (brand hexes tested) + CSS vars, @pulse/ui primitives 19/19, fonts/logo/favicon, shell per brand mockup (drawer, skip link, patient banner), dashboard demo; prod smoke 200 |
| W02 | API client + secure staff session/facility bootstrap | FE-001 §24–§25, IAM-001, API-001 | Done | [SPRINT_W02](sprints/SPRINT_W02.md) | encrypted cookie, backend identity/memberships, allowed facility selection, login/MFA/logout, real-browser/live DB proof; clinical wiring and production acceptance follow |
| W03 | Patients worklist + chart overview | UX-001 §36–§37, CLIN-001 | In progress | [SPRINT_W03](sprints/SPRINT_W03.md) | registration plus redesigned longitudinal record: visits, vitals, notes/addenda, problems/allergies, medications/administrations, investigation orders, document metadata and contacts; scoped/paginated history; wider identity and clinical write workflows remain |
| W04 | Appointments & queues | UX-001 catalogue | In progress | [SPRINT_W04](sprints/SPRINT_W04.md) | outpatient check-in → nurse claim/vitals → assigned consultation worklists; appointment booking and wider queue management remain |
| W05 | Encounter & clinical documentation | UX-001 §38 | In progress | [SPRINT_W05](sprints/SPRINT_W05.md) | rich SOAP notes/sign/addenda; problems/diagnoses and resolution; structured allergy recording, explicit negative/unknown reviews, attributed corrections and persistent safety summary; wider documentation/encounter scope remains |
| W06 | Orders & diagnostics review | UX-001 §40–§41 | In progress | [SPRINT_W06](sprints/SPRINT_W06.md) | verified findings; lab ordering/cancellation; facility duty queue, identity-confirmed single-specimen collection and receipt/accession; attributed manual result revisions and independent verification/publication; named critical communication/read-back, explicit clinician acknowledgement and pending header/worklist; per-case scheduled backup activation and immediate cover; facility-wide escalation policies, validation configuration and wider diagnostics remain |
| W07 | Medications & eMAR | UX-001 §42–§43 | Pending | - | prescribing, administration |
| W08 | Nursing ward board | UX-001 §44 | Pending | - | nurse workspace |
| W09 | Administration surfaces | IAM-001 catalogue, ONB-001 | Pending | - | org/facility/users/privileges screens |
| W10 | Accessibility & responsive audit pass | UX-001 §30–§33, QA-001 | Pending | - | keyboard walkthrough, contrast, responsive matrix |

The complete plan assigns further scope to W11–W22 and decomposes earlier bands where required. Referrals, theatre, revenue/insurance, inventory, reporting, anatomy, portal, specialist pathways, governance, integrations, offline, migration and onboarding are explicitly catalogued now; detailed sprint sizing follows each band's contract/design readiness. Critical consent, permissions, tasks and accessibility are delivered with their owning workflow rather than deferred to a later audit.

W06 imaging update (2026-10-22): delivered facility-catalogue request/review/attestation, laterality validation, attributed history and versioned early cancellation. Radiology duty worklist, protocol/safety screening, acquisition, governed reporting and PACS remain pending. See SPRINT_W06 for verification and limits.

W06 radiology update (2026-10-22): delivered facility-duty request queue, priority/stage filters, search, stable pagination, metadata-only read audits and request-review desktop/mobile drawer. Radiology is integrated into permission-controlled sidebar/search/workspace. Protocol/safety approval, scheduling/acquisition, reporting and PACS remain pending; see SPRINT_W06.

W06 protocol review update (2026-10-22): versioned facility/procedure templates, configured screening evidence, attributable hold/approve-for-planning decisions, prior-review history and explicit review/attestation delivered. `imaging:protocol` is separate from radiology duty reads. Planning decisions do not advance operational scheduling/acquisition or approve contrast administration. Governed template administration, full clinical configuration/acceptance and subsequent operational steps remain pending; see SPRINT_W06.

W06 scheduling update (2026-10-22): configured facility resources/procedure slots and first-booking drawer delivered, with explicit planning approval gate, capacity/downtime checks, concurrent one-slot allocation, reviewed/attributed confirmation and appointment display. Rescheduling/cancellation/no-show, calendar administration, equipment-state synchronization, emergency overrides and acquisition remain pending. See SPRINT_W06 for scope and evidence.

W06 appointment changes (2026-10-22): reasoned, reviewed and attributed rescheduling/cancellation, atomic replacement, reusable released capacity and retained appointment history delivered. Appointment cancellation leaves the clinical imaging request open. No-show/arrival, post-processing clinical cancellation, equipment synchronization and acquisition remain pending; see SPRINT_W06.

W06 attendance/PACS update (2026-10-22): two-identifier arrival, reasoned manual no-show, race-safe attribution/history, live acquisition prerequisite checks and server-only Orthanc connection indicator delivered. The local Orthanc/DICOMweb sandbox passed a cleaned synthetic store/query/retrieve roundtrip. Clinical acquisition, modality worklists, study reconciliation, reporting/viewing and procedure-day safety configuration remain pending; see SPRINT_W06.

W06 acquisition update (2026-10-22): procedure-day checklist/review/attestation, immutable generated work item, Prepared stage and verified Orthanc study linking delivered in the radiology desktop/mobile drawer. Missing/mismatched/unavailable studies retain the prepared request; successful verification records attributed acquisition. Chrome passed the actual three-image synthetic Orthanc flow, with failure/retry, mobile Escape and overflow checks. Normal demo.radiology/demo.admin permissions and labelled preview checklists are enabled. Approved clinical configuration, scanner/worklist integration, correction/reconciliation, reporting and diagnostic viewing remain pending; see SPRINT_W06.

W06 reporting update (2026-10-22): structured study-pinned draft revisions, retained history, distinct report/finalise permissions, explicit diagnostic-image-review evidence and routine final sign-off delivered. Drafts remain withheld from the patient chart; final text carries its sign-off timestamp. Urgent/critical release and reclassification are held pending accountable communication. Chrome passed synthetic acquisition through draft, revision and final sign-off with desktop/mobile failure/retry checks. Amendment/preliminary publication, routine review routing, critical acknowledgement/escalation and diagnostic viewing remain pending; see SPRINT_W06.

W06 imaging handoff update (2026-10-22): named responsible-clinician selection, report pinning, attributed contact/read-back attempts, explicit scoped acknowledgement and acknowledged urgent/critical final-release gate delivered. Imaging now appears in shared follow-up navigation, header/workspace counts and a paginated pending queue with overdue state. Chrome passed the two-user synthetic flow with mobile review, Escape and retry retention. No external delivery or automatic backup routing is claimed; configured escalation, reassignment/correction, completed-case navigation, routine result-review and diagnostic viewing remain pending. See SPRINT_W06.
