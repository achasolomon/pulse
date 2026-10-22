# Pulse frontend delivery plan

User decisions, 14 October 2026: SSO is excluded from the current product. MFA is optional account configuration and becomes a mandatory second password-sign-in step only after enablement. Password recovery uses verified staff email. Facility choice is a compact dashboard modal after sign-in and a working header dropdown for later switching, rather than a separate entry screen. See [W02 follow-up evidence](sprints/SPRINT_W02.md).

Version 2 — full product scope, 13 October 2026; W02 implementation status added 14 October 2026. Baseline following the [system review](SYSTEM_REVIEW_2026-10-13.md), expanded against the documentation corpus before implementation. Production approval remains separate.

W02's bounded staff session/facility foundation is implemented and verified: see [the sprint evidence](sprints/SPRINT_W02.md) and [session decision ADR-008](ADRs/ADR-008-staff-web-session.md). This does not complete the broader foundation/administration catalogue band. Patient/resource authorization, privacy, provenance and command consistency checks remain prerequisites to W03 clinical wiring.

Read with the [full functional scope catalogue](FRONTEND_SCOPE_CATALOGUE.md), [all 87 UX screen mappings](FRONTEND_UX_SCREEN_MAP.csv), [source section coverage](FRONTEND_SOURCE_COVERAGE.csv) and [source manifest](FRONTEND_SOURCE_MANIFEST.csv). The catalogue is part of this plan, not an optional backlog. Missing backend functionality is a tracked dependency, not omitted frontend scope.

## Delivery objective

Build a safe, usable frontend for the whole documented Pulse product, starting with one complete outpatient visit. Preserve the brand, domain authority and existing foundation. Add missing backend functionality and contracts required by documented workflows as small owned increments. The current backend is the implementation baseline, not the ceiling on frontend scope.

The first acceptance milestone is:

**Staff sign-in → authorized facility selection → patient search/register → appointment/check-in → encounter → vitals → draft/sign note → problem/allergy → lab order → timeline.**

This follows BACKLOG-001 §12–§13. It includes denied access, wrong context, expiry, duplicate submission, conflict and unavailable dependency cases. A collection of attractive standalone screens does not meet this milestone.

Assumption for sequencing: outpatient/front-desk/clinician workflow is the first pilot target; wards and specialist departments follow. Confirm facility type, clinical owner, roles, deployment topology, browser/device/peripheral baseline and inpatient scope during discovery. Those answers adjust later scope, not the need for safe sessions, context and resource authorization.

## Scope and ownership

| Surface | Responsibility | Delivery approach |
|---|---|---|
| `web-clinical` | Staff operational workspaces: registration, care, diagnostics, pharmacy, wards, referrals, cashier/claims/stores | Start here; show only effective capabilities/workflows, with genuine routes. |
| `web-admin` | Organization configuration, memberships/privileges, access reviews, security, integration/system health | Minimum secure provisioning/discovery is an early prerequisite; broader separate app follows core workflows. Share UI, never grant automatic chart access. |
| `web-patient` | Patient/proxy appointments, released results, medicines, bills, referrals, privacy | Separate auth and cache boundary; mobile-first delivery after staff records/result-release policy are verified. |
| Specialty/edge | ED/theatre/transfusion/dialysis/ICU, anatomy and approved bedside/offline use | Explicit scope, contracts and safety acceptance; heavy assets loaded only in relevant features. |

Use existing packages. Do not pre-create every FE-001 recommended package. Add a package only when a real second consumer or ownership boundary justifies it. The BFF translates transport/session boundaries; owning backend modules remain responsible for clinical and financial rules.

## Architecture decisions for implementation

1. **Retain Next.js/React/TypeScript and plain CSS tokens.** A dependency upgrade is a separate verified task with an ADR/change record where appropriate. Preserve current styling until workflow evidence justifies a change.
2. **Use a trusted server session.** W02 uses a versioned authenticated encrypted BFF cookie with backend validity/revocation checks and backend-provided expiry, retaining `iam.session` as the authoritative store ([ADR-008](ADRs/ADR-008-staff-web-session.md)). Deployment key distribution/rotation and proxy/HTTPS acceptance remain explicit release work. `HttpOnly` unsigned JSON is insufficient.
3. **Bootstrap context server-side.** Add authenticated actor, allowed organizations/facilities, effective capabilities and selected context contracts. Validate selection against membership. Never hardcode the facility or trust browser privilege values.
4. **Keep patient/encounter context in routes.** Opaque IDs identify resources; server validates ownership. Banner identity comes from authorized reads. No silently pinned global patient after logout or context switch.
5. **Centralize transport, distinguish browser BFF calls from backend calls.** Token stays server-side. Domain modules own typed request/response shapes; features wrap queries and commands. Full OpenAPI generation is the target; reviewed shared types may bridge each slice while generation is introduced.
6. **Choose one interactive server-state strategy.** Recommended: a query/cache library for worklists/chart panels, with Next primitives for session/layout entry. Select the package/version during implementation after documentation/security checks. Keys include actor/session, tenant, facility, patient, encounter, resource and filters as applicable. Cancel stale searches and clear sensitive data on logout/context loss.
7. **Keep forms local and schema-driven.** Separate draft/save/sign; preserve dirty values on recoverable errors. Do not add draft autosave before update/version APIs exist. Use a focused form/schema library only when the first substantial form proves the need.
8. **Confirm consequential writes with the server.** No optimistic clinical signing, administration, payment or referral outcome. Unknown network outcome requires reconciliation using command key/resource status, not blind resubmission.
9. **No PHI persistence by default.** No chart/localStorage cache, patient names/search text in URLs or analytics, or token in client bundles. Private server reads use explicit cache policy. Offline is an approved separate capability.
10. **Build accessibility into every slice.** The W10 audit verifies earlier acceptance; it does not postpone keyboard, focus, contrast or responsive safety work.

Suggested feature layout:

```text
apps/web-clinical/
  app/                         # thin route/layout composition, BFF handlers
  features/
    patients/
      screens/ components/ queries/ commands/ models/ mappers/ validation/ tests/
    scheduling/
    encounters/
    clinical/
    laboratory/
  components/                  # application shell and genuinely shared composition
  lib/                         # server session/context, transport adapters, formatting
packages/
  ui/                          # tokens and generic accessible controls
  api-contracts/               # governed boundary types / generated schema artifacts
  api-client/                  # transport, errors, auth and typed endpoint calls
```

Clinical context widgets become shared only when multiple features need them; domain commands stay in their feature/module.

## Proposed routes and workspace behavior

Route names below are proposals; the backend API paths remain those of the owning modules. All protected routes require authoritative authorization, including deep links.

| Route group | Purpose |
|---|---|
| `/login`, `/select-facility` | Sign-in/MFA, membership-based facility/workspace entry |
| `/` | Actor/capability-specific work queue and actionable exceptions |
| `/patients`, `/patients/new` | Bounded search/worklist and registration |
| `/patients/[patientId]` | Authorized chart overview and persistent identity |
| `/patients/[patientId]/timeline` | Read-only longitudinal projection with resource links/source |
| `/patients/[patientId]/encounters/[encounterId]` | Explicit encounter workspace/context |
| Encounter child routes `/notes`, `/vitals`, `/orders` | Draft/sign/addendum, observations and contextual orders |
| Patient child routes `/results`, `/medications`, `/allergies`, `/problems`, `/documents`, `/referrals` | Focused authorized chart sections |
| `/appointments`, `/queues` | Schedule and flow; appointment remains distinct from encounter |
| `/laboratory`, `/imaging`, `/pharmacy` | Role-specific departmental workbenches |
| `/wards`, `/beds`, `/handover` | Nursing/ADT workspaces |
| `/billing`, `/claims`, `/inventory`, `/referrals`, `/reports` | Operational workspaces with appropriate data minimization |

Use actual effective capabilities, not a single “Clinical staff” role or every module for every user. Counts navigate to the same scoped underlying list. Preserve filters when returning from detail. Global patient search is visibly separate from active chart context. Every advertised link/shortcut has behavior or is clearly unavailable.

## Work required before live patient screens

| ID | Deliverable | Acceptance evidence | Owner role |
|---|---|---|---|
| FND-01 | Trusted BFF session, expiry/revocation, malformed-cookie recovery, same-origin mutation policy, private cache/security headers | Session tamper/expiry/revocation/login/logout tests; no client token; shared-workstation recovery | Frontend + IAM/security |
| FND-02 | Authenticated actor/membership/facility/capability discovery and deliberate context switch | Actor can enumerate only authorized facilities; switch clears queries/drafts/patient; wrong membership denied | IAM + organization + frontend |
| FND-03 | Server-derived object/patient/encounter/facility checks; canonical privilege taxonomy | Real HTTP negative tests across two tenants/facilities/patients, including absent/spoofed headers | Backend domain owners + security |
| FND-04 | Transaction/outbox/audit/actor requirements for first-slice commands | Inject event/audit failure; state/event consistency; server-bound author; safe replay/concurrent outcomes | Platform + clinical owners |
| FND-05 | Screen/API inventory and machine-readable contract baseline | Reviewed request/response/error/status types; contract tests; bounded queries and object detail | Backend + frontend |
| FND-06 | Reproducible test/CI baseline with browser workflow coverage | Fresh isolated DB+migrations+seed; component/contract/API/browser checks; no silent skipped suites | QA/platform |
| FND-07 | Brand/component corrections and truthful shell | Contrast-safe status text, defined CSS tokens, safe drawer, sticky patient context, real nav; demo isolated | Frontend/design |

FND-03 and first-slice FND-04 block real patient reads/writes. Mocked component design can proceed while contracts are being repaired, provided no fixture is presented as production clinical truth.

## Delivery waves

W identifiers retain the existing tracker meaning. New items after W10 are proposed. A “sprint” here is a sequencing band, not a calendar estimate; split a band when its acceptance scope exceeds available capacity.

| Wave / band | Scope | Contract dependencies | Exit demonstration |
|---|---|---|---|
| 0 — W01 review follow-up | Harden existing tokens/primitives/shell; explicit demo mode, brand assets, contrast, keyboard/drawer/patient persistence | FND-07 | Component catalogue and keyboard states reviewed against boards |
| 0 — W02 completion | Auth/MFA/session, backend validation, actor/capability discovery, authorized facility selection, error handling, route protection | FND-01/02/03, shared contracts | Real staff login → allowed facility → safe shell → expiry/logout; malformed/revoked session denied |
| 1 — W03 | Patient search/register/duplicates, chart overview/banner/timeline | Search identifiers/pagination, summary/alerts projection, resource scope, registration idempotency | Register/search, disambiguate patient, open chart; duplicate candidate review and wrong-patient negative |
| 1 — W04 | Appointment booking/day view/check-in/queue, role home, encounter entry | Schedule/detail/read contracts, department/provider availability, cancellation reason | Front desk books/checks in; clinician sees matching queue and opens encounter |
| 1 — W05 + W06 lab-order subset | Vitals, draft/save/sign/addendum, problems/allergies, one lab order, timeline | Note detail/update/version, observation/entry reads, catalogue search, transaction/audit/provenance | Full first outpatient journey and required negative/browser/clinical acceptance |
| 2 — W06 remainder | Lab collection/accession/results/verify/critical review; imaging order/report | Results/reference intervals/detail/review responsibility; imaging worklist/detail and adapter availability | Order-to-result and accountable acknowledgement; corrected results/history preserved |
| 2 — W07 | Prescribing, pharmacy verification/dispense, administration; full eMAR only after schedule model | Staff medication/catalogue/worklist/detail reads, scheduled-dose model, omission/hold rules, stock traceability | Separate prescribe/verify/dispense/administer events; due/overdue/not-given, no duplicate dose |
| 2 — W08 | Ward/nursing/vitals flowsheet, admission/bed/transfer/discharge, handover/tasks | ADT/bedflow integration, assigned patient/tasks reads, safe concurrent occupancy | Admission/transfer/discharge with persistent identity and handover; medication state intact |
| 3 — W09 | Broader admin app: users/memberships/privileges/facility, access/audit/health | IAM admin APIs, controlled configuration lifecycle, scoped audit | Least-privilege admin provisions actors; cannot automatically view charts |
| 3 — W10 | Formal cross-workflow accessibility/responsive/browser/performance audit | Earlier slice evidence, realistic datasets/network profile | Keyboard/reader/zoom/phone/tablet/desktop matrices accepted; selected NFR targets measured |
| 4 — W11 | Cashier/patient account/charges/invoices/payments/refunds/receipts | Financial read projections, currency/precision, payment idempotency, authoritative receipt/export | Cash workflow reconciles; unknown payment outcome resolves safely; care unaffected |
| 4 — W12 | Payers/contracts/tariffs, coverage/eligibility/preauth, claim workbench/denials | Insurance reads, coverage selection, responsibility and submissions; adapters explicitly scoped | Insured journey with pinned tariff, party shares and auditable claim timeline |
| 4 — W13 | Inventory/stores/procurement/batches/expiry/counts | Ledger/location/item/procurement reads and approval scope | Receive→issue→count/reconcile traceable ledger; no direct balance edits |
| 4 — W14 | Notifications/tasks, governed documents/print/export | Notification read API, storage/quarantine/signed file access, print templates/audit | Authorized task deep link and document upload/download/export; no false critical acknowledgement |
| 5 — W15 | Consent/disclosure and referral coordination | Consent reads/manifest, referral detail/package/outgoing queue, explicit care-assumed state | Sending/receiving facility journey; accept/arrive/care-assumed remain separate |
| 5 — W16 | Patient/proxy portal app | Patient release policies, own/proxy context, separate session/cache, scoped document/appointment writes if included | Patient/proxy sees only released authorized data; proxy identity clear |
| 5 — W17 | Reporting/Insights | Report metadata/freshness, metric definitions and permissions; warehouse only if approved | Scoped census/revenue/claims drill-through, visibly dated data |
| 6 — W18 | Anatomy: structured text/2D first, versioned finding lifecycle; 3D in a separate asset spike | Licensed model manifests/assets, laterality semantics, retained historical versions, accessibility | Draft/sign/amend semantic finding usable without 3D; renderer failure preserves text access |
| 6 — W19 | ED/theatre/blood bank and specialty boards | Missing worklists/details, specialist safety prerequisites, clinical owner | Acuity, site/checklist, crossmatch/transfusion scenarios with specialist sign-off |
| 6 — W20 | Dialysis/equipment/workforce/ICU/research surfaces | Existing reads extended to approved workflow scope; re-identification controls | Role-specific programs/maintenance/rosters/level-of-care/governance demonstrations |
| 7 — W21 | Approved bedside/edge/offline experiences | Deployed edge runtime, signed scoped policy, encrypted local storage, allowed command set and sync reconciliation | Restart/outage/reconnect/conflict tests; no broad fail-open or false synchronized state |
| 7 — W22 | Pilot readiness, training, cutover and hypercare | CI/security/SCA, clinical/privacy review, current restore/downtime/support evidence | Facility acceptance, safe production activation and accountable support |

Do not delay required permission/context/admin bootstrapping to W09. Do not delay accessibility to W10. Conversely, do not build full PACS, medication CDS, payer EDI, research query execution or offline browser behavior merely because a backend epic is marked Done. Each requires its own verified scope.

## First milestone screen and contract backlog

| Screen IDs | UI deliverable | Existing endpoint/port | Required addition or clarification |
|---|---|---|---|
| UX-FND-001/002 | Sign-in/MFA | `/iam/auth/login`, `/logout`; auth BFF | Session expiry/validation response, tamper/revocation recovery and consistent MFA code behavior |
| UX-FND-003 | Facility/workspace selection | Membership repository; organization lists | Staff self/membership/capabilities discovery without circular facility-header dependency |
| UX-CLN-001, UX-FND-004 | Clinician home/global search | Patient search, appointment queue, tasks | Actor-scoped counts/reads, pagination/filters, search identifier data |
| UX-FND-005/006/007 | Registration/identity/duplicate review | Patient create/summary/duplicates/merge | Bounded duplicate candidates, identity policy, separate governed merge authority |
| UX-FND-008/009 | Chart overview/timeline | Patient summary, clinical timeline, internal entry/medication ports | Scoped overview with known/unknown allergies, recent vitals, active encounter, IDs/provenance/freshness |
| Appointment/front-desk §56 | Day schedule and queue | Appointment commands/queue | Date range/provider filters/detail, reasons, explicit encounter linkage rather than inference |
| Encounter context | Open/detail encounter | Encounter create/detail/history | Authorized active/history worklist, resource patient/facility validation |
| UX-NUR-003 | Vitals | Clinical vitals command | Observation history/value/unit/time/source reads; explicit effective time and corrections |
| UX-CLN-002/003 | Consultation note/problems/allergies | Draft/sign/addendum/entries | Read draft/signed note, update versioned draft, author/signer attribution, structured entry reads |
| UX-CLN-004 | First lab order | Lab order, test definition | Search catalogue, valid encounter association, durable command key/result, order detail |

Screen IDs come from UX-001 §§84–§91. All 87 are mapped now in the linked screen register. Domain-specification capabilities beyond those screen IDs are included in the full scope catalogue. At wave entry, expand each capability into **ID, owner, actor, route, read contract, commands, privileges, hazards, state matrix, acceptance evidence and delivery status**. Preserve domain state vocabularies instead of normalizing them to a generic status enum.

## Full scope allocation and sequencing corrections

The earlier wave table is the delivery overview. The following allocation is its complete functional expansion. A band containing several sub-bands must be decomposed and estimated; its W number is not a promise that all work fits one sprint. This table and the scope catalogue supersede any narrower reading of a wave description.

| Band | Capability groups / proposed decomposition | Acceptance beyond the earlier overview |
|---|---|---|
| W01/W02 | FND; early ADM-01–07 provisioning/credentialing/capabilities, FND-11 break-glass; Q | Staff/role/facility bootstrap, self-security/recovery/workstation handling; external authentication methods only after adapter approval |
| W03 | IDN; GOV-04 record/identity correction handoff | Complete demographics/related persons, duplicate/merge history and governed correction; provisional identity and record-read dependencies kept visible |
| W04 | SCH; encounter CLN-01/02 | Actual resource/provider calendars, recurring/blackout/capacity policy, reasons/reminders and patient-flow ownership |
| W05 | CLN documentation, problems/allergies, care plans, internal consults, clinical tasks/result follow-up, supervision/co-sign and outpatient closure | W05a notes/vitals; W05b care coordination/program model; W05c correction/refusal/continuity. First-visit acceptance remains an early subset, not total clinical scope |
| W06 | LAB, IMG, generic CLN orders/results and INT adapter/reconciliation views | W06a order/result basics; W06b specimen/validation/critical review; W06c radiology/protocol/screening/viewer; W06d QC/send-out/discipline extensions. Each has its own contract and clinical reviewer |
| W07 | MED | W07a catalogue/reconciliation/prescribe; W07b verification/interventions/partial dispense; W07c scheduled eMAR/PRN/infusion; W07d controlled drugs/recalls/adverse events. Barcode/CDS activate only after validation |
| W08 | NUR/ADT; CLN discharge/deterioration/refusal/death and MED transition reconciliation | Ward assessments/intake-output/devices/handover, reserved vs occupied beds, receiving responsibility and discharge pending-result continuity |
| W09 | ADM/GOV, INT operations, OPS health links | W09a configuration/roles/privileges; W09b consent/rights/retention/audit; W09c security/JIT/access reviews/incident/governance; W09d integration/terminology. Required clinical consent/access behavior lands earlier with its workflow |
| W10 | Q verification across delivered capabilities | Ongoing per-slice evidence plus formal cross-browser/accessibility/responsive/performance acceptance; later waves repeat their own checks |
| W11 | REV self-pay/account/payment/control subset | W11a estimate/deposits/charges/invoices; W11b till/payments/allocations/receipt/refund; W11c reconciliation/credit/close/corporate/assistance and integrity queues |
| W12 | REV insurance/payer/benefit/preauth/claims/remittance subset | W12a payer/tariff/coverage; W12b eligibility/benefits/preauth; W12c claim/adjudication/appeal; W12d remittance/reconciliation. Capitation/packages remain conditional scope, not implied CR-001 initial-phase delivery |
| W13 | INV | W13a masters/locations/batches/ledger; W13b requisition/PO/receipt/supplier; W13c transfers/reservations/counts/returns/quarantine/recall; W13d forecasting/sourcing/ERP handoffs as enabled |
| W14 | DOC/WRK | File lifecycle/quarantine/authorized access/print/export; notification and task lifecycle with timers; domain-critical tasks already delivered with their earlier bands |
| W15 | REF; GOV disclosure; INT external-recipient handoff | Directory/capacity freshness, exact manifests/versions, information loop, conditional acceptance, transit/arrival/care-assume and continuity outcome—not only messages and an inbox |
| W16 | PAT | W16a verified patient/proxy entry and released care; W16b enabled appointments/messages/payments/requests; W16c privacy/consent/dependent transitions/access transparency. No silent staff feature reuse across auth boundaries |
| W17 | REP; data quality/lineage and authorized exports | Operational/clinical/medication/stock/finance/workforce/network/HOD/executive reporting; regulatory/national extracts remain profile-gated |
| W18 | ANAT and specialist asset dependencies | Explicit ANAT-0–6: license/semantic asset spike, general 2D/3D, finding lifecycle, measurements/media/longitudinal, specialty, offline and advanced assistance. A text/2D-first implementation step does not remove the documented approved general 3D requirement |
| W19 | SPC-ED/TH/BB, procedure CLN-14, relevant ICU transfers | Separate ED, theatre/perioperative/anaesthesia and transfusion sub-bands; dedicated specialist acceptance and missing read/workflow contracts |
| W20 | SPC-ICU/REN/REC/MAT/PED/ONC/MH/PT/DEN/EYE/IMM/EQP/WF; RES/CDS | Split critical care, recurring renal/general programs, configured specialties, equipment/workforce and research governance. AI/CDS and complex specialist protocols are conditional reviewed extensions |
| W21 | EDGE; bedside subsets and approved asset packages | Identity/policy expiry, encrypted local storage, per-domain allowed commands, reconnect/uncertainty/conflict/device loss and restart survival; central device registration alone is not offline delivery |
| W22 | OPS/MIG/ONB, release acceptance across all enabled groups | Separate operator/support health/evidence, migration workbench/reconciliation, discovery/configuration/training/readiness and go-live/hypercare. Tooling execution can remain external with governed status/handoff |

Each product capability stays in the scope register even if the first pilot disables it. A conditional extension requires a named activation prerequisite and delivery owner before scheduling. An external boundary still needs its declared product handoff/failure/status/reconciliation behavior. Do not replace these dispositions with “later” or silently delete a requirement because a backend read route is absent.

## Complete role and workspace allocation

| Actor family | Primary workspaces / scope |
|---|---|
| Front desk / records / HIM | Identity/register/duplicate review, appointments/queue, minimum-necessary financial readiness, record correction/copy routing |
| Clinician / specialist | Assigned work, chart/encounter/notes/diagnoses/orders/results/care plans/internal consult/referral/procedures/discharge |
| Resident / intern / supervisor | Permitted drafts/actions, assigned supervision/co-sign review and original authorship |
| Nurse / midwife / ward lead | Assigned ward/bedside, assessments/vitals/intake-output/devices/eMAR/tasks/handover/escalation and discharge |
| Collector / lab accession / scientist / validator / supervisor | Collection/receipt/workbench/results/QC/verification/critical communications/send-out/mapping exceptions |
| Radiographer / radiologist / modality scheduler | Protocol/schedule/screening/acquisition/report/critical review/study reconciliation and PACS handoff |
| Pharmacist / pharmacy / controlled-stock accountable staff | Reconciliation/verification/intervention/dispense/counseling/stock/controlled-drug and recall workflows |
| ED / theatre / anaesthesia / transfusion / ICU / recurring-care teams | Their scoped specialty boards/assessments/actions/safety checks/resources/monitoring/handover |
| Referral coordinator / sending-receiving clinician / transport liaison | Scoped referral package/decision/preparation/transit/arrival/care-assume/outcome; no unrelated chart access |
| Cashier / billing / claims / coding / remittance / credit / finance | Patient account/payment/till, coverage/preauth/claims, coding queries, settlement/receivables/close with SoD |
| Department requester / stores / procurement / receiving / inventory controller | Demand/approval/sourcing/supplier/PO/receipt/ledger/transfer/count/recall; patient detail only when needed |
| HOD / unit lead / executive | Scoped supervision/resource/coverage and aggregate operations/quality/finance dashboards; restricted drill-through |
| IAM / clinical credentialing / facility configuration administrator | Account/member/role/professional privileges, approved configuration and service/device identities |
| Privacy / auditor / clinical safety / ethics / research governance | Consent/disclosure/rights/retention/access/incident/approval/hazard/evidence and governed research exports |
| Platform/SRE/security/integration/support/implementation/training | Health/alerts/exception queues/approved support/migration/configuration/readiness/evidence, or controlled external-tool handoff |
| Patient / independent proxy/guardian | Mobile own/authorized dependent care, appointments/results/medications/bills/documents/referrals/messages/consent/rights |

These are responsibility families, not hardcoded permission bundles. Effective actions remain governed by membership, professional privilege, assignment, purpose, consent/sensitivity and server resource policy.

## Cross-domain journeys required for acceptance

| Journey | Required end-to-end scope |
|---|---|
| First outpatient visit | FND → IDN → SCH → CLN vitals/note/entry → LAB order → timeline and audit |
| Routine and critical diagnostics | Order → collection/acquisition → validation/report → recipient review/critical acknowledgment → action/follow-up; corrections re-notify appropriately |
| Medication transitions | History/reconcile → prescribe → verify/intervene → batch dispense → due dose/admin/omission/monitor → discharge or transfer reconcile |
| Inpatient care | Admit decision → bed readiness → arrival/care acceptance → assessments/observations/tasks/eMAR → transfer/handover → discharge/pending results |
| Emergency/surgical/transfusion | Provisional identity/triage → urgent care → site/consent/checklist/product checks → actual intervention/monitor/reaction → disposition/handover |
| Insured and self-pay care | Coverage/estimate/auth if appropriate → actual care → charge → invoice/party allocation → payment or claim → adjudication/remittance/refund/close; clinical state stays independent |
| Supply chain and recall | Demand → approval/supplier/PO → inspect/receive → batch/transfer/reserve/issue → actual use/return/count → recall exposure/clinical follow-up |
| Referral transfer | Directory → exact consented manifest → acknowledge/review/info loop/accept → prepare/transit → arrive/handover/care-assume → outcome/local reconciliation |
| Patient/proxy access | Verified own/dependent scope → released care/status → messages/appointments/payments/requests → revocation/age transition and sensitive-release negatives |
| Config and access change | Request → independent clinical/security/privacy review → version/effective publish → active workflow/access impact → rollback/history/evidence |
| Offline/downtime | Valid scoped cached state → explicit local/queued or fallback → restart → reconnect → duplicate/conflict review → clinical/stock/financial reconciliation |
| Migration and rollout | Source/mapping/identity → rehearsal → domain/sample reconciliation → readiness/training/go-no-go → cutover → hypercare/acceptance |

## Visual and UX quality brief

**The brand samples establish the expected quality, not final design.** They illustrate a calm professional interface, coherent teal/sage identity, readable information hierarchy, compact clinical data, clear controls and thoughtful contextual organization. They do not freeze exact layouts, menu counts, screen contents, copy, component sizes or illustrative workflow decisions. Final designs are created around verified role tasks, realistic data density and the relevant safety states.

| Reference | Direction to preserve | Design work still required |
|---|---|---|
| Dashboard mockup — sign-in | Polished brand entry, calm background, clearly grouped credentials/action/help | Actual authentication methods, MFA/recovery/errors, privacy/assurance and responsive accessible flow |
| Dashboard mockup — clinician home | Scannable workload, queues/tabs, contextual actions and visible exceptions | Role-specific priorities/counts/freshness, operative navigation, useful empty/error/denied/stale states |
| Dashboard mockup — chart overview | Strong identity, local chart navigation and clinically grouped summary/history | Persistent context, unknown allergy distinction, current encounter/ownership, permissions/provenance and real chart density |
| Dashboard mockup — documentation | Structured/narrative sections, relevant templates/contextual clinical links and separate save/sign | Draft/version/conflict/co-sign/correction, interruption recovery, keyboard and no false default findings |
| Dashboard and system boards — anatomy | Structure navigation, model viewport, semantic information and related clinical context | Exact licensed assets, semantic picking/laterality/findings, annotation/measurement/history, 2D/text fallback and performance |
| Dashboard mockup — imaging | Patient/study/report context, image navigation and study selection | Authorized PACS handoff, validated viewer boundary, unmatched/external/unavailable states and critical follow-up |
| System board — mobile bedside | Focused patient context/actions, touch-friendly hierarchy and reduced navigation | Approved bedside tasks, medication checks/offline status, focus/reader/reflow and peripheral exceptions |
| Guidelines/system boards | Canonical logo variations, Inter/Jakarta, palette and restrained icon language | Approved asset selection, token contrast variants, component states, density/responsive rules and sub-brand consistency |

Use the source images as side-by-side quality references during design review. Validate final workflow prototypes with representative actors; record which visual principles were retained and why layouts changed. Do not copy mock patient names, diagnoses, counts, timestamps or unsupported SSO/viewer functionality into production screens.

Required design deliverables before a capability is implemented: role journey, screen inventory/spec, realistic prototype including failure/permission/offline/conflict states, responsive behavior, keyboard/focus/reader annotations, clinical safety annotations and approved copy. Establish a reusable component gallery and visual regression baseline as screens mature. A new UI library or wholesale visual redesign is not implied by this scoping update.

## Source coverage and open decisions

The source manifest includes all 31 DOCX files; three duplicate pairs are recorded rather than treated as different requirements. The coverage CSV indexes all **2,768 Word headings**, including nested functional headings and appendices, and records frontend capability/control or external boundary disposition. Preambles, Markdown sections and brand files are also recorded. It is a section-level coverage check, not proof that every SHALL requirement has passed implementation tests. All 87 UX screen IDs have explicit capability and delivery-home mappings.

Markdown ADRs, trackers, sprint records, runbooks, the operating model and CR-001 provide implementation/decision evidence; they do not narrow an authoritative domain requirement simply because a historical sprint excluded it. The manifest also records these sources and the seven brand files.

Outstanding decisions remain visible: missing standalone DATA-001; approved pilot facility/capability scope; names of clinical/design/QA/security/privacy owners; specialist protocol/specification details; authoritative LIS/PACS/payer/HR/ERP tools and adapter contracts; licensed anatomy/terminology/photo/AI assets; exact certified devices/peripherals; final UI prototypes. No application implementation begins as part of this documentation update.

## Required UI state matrix

| State | Presentation / behavior |
|---|---|
| Loading | Preserve known context; skeleton/progress, never “no records” |
| Empty / filtered empty | Explain true zero data or active filters; permitted next action |
| Unauthorized | Safe reason/recovery; do not fetch restricted records just to hide them |
| Expired session/context | Clear protected queries/context and recover sign-in/facility selection; protected draft policy explicit |
| Failed dependency | Unavailable/retry; correlation reference; distinguish from absence |
| Stale | Show relevant last-updated time and scope; safe refresh |
| Conflict | Current server version; preserved local draft; deliberate reconciliation |
| Command pending | Disable duplicate UI action; retain exact target patient/encounter |
| Unknown write outcome | Explicit uncertainty; reconcile by command key/resource state |
| Confirmed success | Durable server result; invalidate affected scoped queries |
| Offline / queued | Persistently distinguish offline, queued, synchronized and conflicted; queue only approved workflows |
| Signed/final/amended | Read-only final content; addendum/correction, original provenance retained |
| Critical / overdue | Text+icon+contrast-safe color, accountable action/escalation; notification read is not acknowledgement |

## Design-system and branding backlog

Keep the existing teal/sage direction and Inter/Jakarta typography. Resolve canonical logo exports and tagline usage once, then reuse them. Maintain separate semantic foreground/background/border tokens so accessibility changes preserve brand accents.

| Timing | Components / work |
|---|---|
| Foundation | Contrast-safe badges/alerts, corrected CSS variables, trusted shell identity, real nav, focus-safe drawer/modal, sticky responsive banner |
| Patient/queue | Accessible search/combobox, bounded data table/filter/pagination, chart tabs/breadcrumbs, safe date-only/instant formatting, dirty-form protection |
| Clinical | Numeric-unit fields, save/sign review, conflict reconciliation, timeline/provenance, allergy unknown vs negative, results with units/ranges |
| Departmental | Result row, medication row/schedule, work queue, flowsheet, task drawer, reasoned command confirmation |
| Operations | Money/currency inputs, allocation summary, ledger table, uploader/quarantine/download/print states |
| Specialty | Anatomy semantic selector/text alternative, version-aware 2D/3D canvas, specialist checklist/compatibility controls |

Use a component gallery with realistic synthetic density and all states; adopt visual regression for banner/worklists/critical review. Marketing photography can support auth/onboarding if licensed, but clinical workspaces prioritize task data. Samples inform quality and visual language while final role workflows are designed independently. SSO, Smart Card, anatomy and viewer affordances appear only when their contracts are functional.

## Acceptance and verification

Every story follows the existing operating-model Definition of Ready/Done. Add frontend traceability **spec/screen → hazard → API/command → automated/manual verification → evidence → acceptance owner**.

| Layer | Required evidence |
|---|---|
| Pure/component | Validation/mapping, keyboard/focus, patient identity, loading/error/empty/permission/conflict behavior |
| Contract | Governed types, machine error codes/field paths, pagination, statuses, versions, idempotency |
| API integration | Fresh isolated PostgreSQL+migrations; real staff sessions; ownership/cross-tenant/cross-patient negatives; audit/outbox consistency |
| Browser E2E | Complete first visit, expired session, facility switch, wrong-patient confirmation, double-submit/unknown outcome, signed-note addendum |
| Clinical scenarios | Critical acknowledgement, separate dispense/administer, separate referral accept/arrive/care-assume as those waves land |
| Accessibility/visual | Keyboard completion, screen-reader semantics/announcements, contrast, zoom/reflow, focus, tablet/phone critical data, reduced motion |
| Performance | Realistic rows/history/network; selected NFR-001 UI targets measured; lazy heavy features; query budgets |
| Release | Threat/privacy/safety review, current dependency findings, reproducible CI/build, restore/downtime/training/support evidence |

Use existing package commands for unit/client/UI/API checks. Add real browser tests to `web-clinical`; its current `test` placeholder cannot satisfy acceptance. Ensure root quality tasks actually include backend typechecking and database/browser suites; record skipped prerequisites as unverified, not green. Do not run integration suites that create/delete fixtures against a shared or production database.

Relevant NFR-001 targets, to validate against a declared capacity/network envelope: local interaction ≤300 ms, common read p95 ≤1.5 s, write/search/order/administration p95 ≤2 s, initial useful chart content p95 ≤2.5 s. `SLO.md` app-side server targets are a different measurement boundary and should remain distinct.

## Immediate execution order

1. Reconcile tracker wording and capture the current W01/W02 working tree as a reviewable baseline without losing existing changes.
2. Turn FND-01–07 into owned stories with explicit tests and contract diffs; resolve P0 authorization/session/first-command durability before live data.
3. Complete W02 and demonstrate real staff sign-in, allowed facility selection, capabilities and logout/expiry recovery.
4. Implement W03 patient identity/chart against verified reads, then W04 schedule/queue/encounter.
5. Implement W05 clinical documentation/vitals and the W06 first lab-order subset; run the full vertical-slice demo and negatives with clinical/QA owners.
6. Estimate later waves from observed throughput and actual pilot scope. Keep backend contract repairs, UI implementation and acceptance evidence separately visible.

Two workstreams are useful: backend contract/security repair and frontend/workflow delivery, coordinated at each screen contract. This describes work ownership, not a requirement to run multiple agents. Numeric owners, team capacity, calendar dates and facility acceptance sign-offs must be supplied before deadline commitments.
