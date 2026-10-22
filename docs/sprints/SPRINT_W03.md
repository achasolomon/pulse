# W03 — Patient worklist and chart overview

Status: In progress. Started 2026-10-14.

Deliver a facility-scoped patient worklist and read-only chart overview using authenticated staff context, explicit privileges and care relationships. Identity must remain visible and never be inferred from a previous patient. Brand samples guide presentation; they are not fixed screen templates.

## Current execution slice

- [x] Verified staff-only patient list/search with identifiers, stable pagination and bounded filters.
- [x] Scoped patient identity and chart reads, current privileges/care relationship and authoritative audit.
- [x] Read-only chart sections with real observations/problems/allergies, source times and explicit unknown/unavailable states.
- [x] Responsive patient worklist, patient identity banner, chart overview, search and real navigation.
- [x] Real PostgreSQL/HTTP negative tests and browser proof; build/lint/type/boundary checks.

## Delivered read slice

`/patients` provides the selected-facility directory, name-prefix/exact-identifier search, active/merged filters and cursor pagination. The header searches patients as well as pages when the current membership permits `patient:read`. Search text is sent in a BFF request body and is not written into browser navigation URLs or audit metadata.

`/patients/[id]` shows a persistent identity banner with name, MRN and date of birth, source facility, record status, recorded allergies, latest observations and recent active problems/diagnoses. Blank allergy data is explicitly unknown. The overview retains values, units, source authority and recorded times; it is bounded to 12 observation codes and 50 recent entries and is not a complete clinical chart.

Backend reads require actual staff identity, current organization/facility membership and `patient:read`. Record opening additionally requires an active care assignment or explicitly granted `care:unrestricted`. Observation/entry sections require `observation:read`/`entry:read`; restricted sections never masquerade as empty clinical data. Identity and clinical overview accesses record authenticated actor and resource audit. Legacy patient reads/writes now check selected-facility ownership; legacy summary/timeline reads also enforce care access, and timeline requires `timeline:read`.

The first read slice is now extended by registration and the outpatient flow documented in [W04](SPRINT_W04.md). Registration uses generated MRNs, explicit duplicate review and atomic command/audit/outbox transactions. Nurses can record observations for their claimed visit and hand it to a selected clinician; the chart shows the active visit and those available actions. Existing clinical export/handover and unrelated write-domain authorization gaps remain in the earlier system review and must be addressed before their own surfaces are enabled.

## Evidence

- Six new real PostgreSQL/HTTP tests: identity/privileges, organization/facility scope, pagination/MRN/date-only fields, wildcard handling, care-header spoofing, recorded units/latest values, inconsistent encounter exclusion, unknown/restricted sections, legacy facility-spoofing denial, revoked care/membership and actor audit.
- Chrome patient smoke: page size and pagination, MRN search, patient identity/units/allergies, navigation clearing prior patient data, header search, unauthorized-record denial, mobile widths, backend-failure versus empty state and recovery.
- Backend 283 unit and 105 HTTP regressions, shared UI 20 tests (including missing-allergy safety), API client 11 tests, API/web builds, lint/type/boundary checks and secrets scan.
- Migration 0036 adds directory indexes and is applied to the persistent local Docker database. Synthetic clinical records are confined to the disposable verification database.

Local UI preview follow-up: the separate opt-in `scripts/seed-local-patient-preview.mjs` provisions six labelled Demo records in the dedicated local demo organization (three per hospital). The latest follow-up also enables explicit local registration/check-in/vitals/consultation permissions and adds `demo.records`. Passwords and MFA are preserved; unrestricted-care access is not granted. Normal localhost:3001 verifies records controls, all three staff queues and the nurse's assigned City General preview chart. The role policy is local demo configuration, distinct from disposable test fixtures and production policy.

## Longitudinal record redesign — 2026-10-15

The patient page now uses a persistent identity header and local chart navigation, as required by UX-001 §§5/36–38. The overview separates current outpatient care, latest vitals, recent encounters, recent active problems and registration/contact information. Desktop uses a main clinical column with a narrower patient/context column; mobile stacks those sections and scrolls the chart navigation within the viewport.

The following sections read real persisted records through `GET /staff/charts/:id/history/:section`: visits/encounters, vitals history, clinical notes, problems/allergies (including resolved entries), medications/treatment, investigations, documents and registration details. History is paginated at 25 records with a lossless timestamp/UUID cursor. Visiting an encounter can filter its vitals, notes and medication history; readable visit type/date identify the context rather than raw database IDs. Measurements retain source, recorded units/times and available actor attribution. Signed notes retain their addenda; only the current actor's own drafts join signed records in the note history.

Each history request checks the current membership, owning facility, care assignment and section privilege, then writes a metadata-only read audit. Investigation branches separately check laboratory and imaging permissions. Document history returns metadata without object-storage keys. Missing clinical records, restricted sections and service failures have distinct states; the summary does not infer that absent allergies or diagnoses mean confirmed absence. The 50-entry summary remains bounded, while the full entry history is paginated.

Six PostgreSQL/HTTP history tests cover identical microsecond timestamps, encounter filtering/mismatch exclusion, note/draft/addendum visibility, resolved problems, medication/administration history, document key exclusion, per-domain permissions, care revocation and read audit. Chrome evidence covers the populated longitudinal overview, encounter-filtered notes, historical treatment, profile/documents, mobile widths, persistent identity and access restrictions. Evidence is under ignored `tmp/patient-record-evidence`. The local preview seed enables these read capabilities only for demo admin/doctor/nurse; it does not manufacture historical care in the normal database.

This redesign exposes historical data already recorded. Note composition/signing is now delivered separately in [W05](SPRINT_W05.md); diagnostic result/report review, document file viewing, a complete eMAR and structured family/social/surgical-history capture remain in their owning scope. No active outpatient visit now returns a valid empty state through the BFF rather than a spurious service failure.

### Remaining broader scope

Extended registration/identity correction, provisional identity, related-person/contact modelling, merge governance, full chart timeline, complete section pagination and accountable clinical/privacy acceptance remain in the W03 scope catalogue. Basic registration/duplicate review and active outpatient context are delivered; W03 stays In progress while the wider scope remains.

Demographic correction/merge, ordering and clinical decisions remain separate scope. Authored nursing/consultation drafts, signing and addenda are delivered in [W05](SPRINT_W05.md). The outpatient follow-up has nine additional PostgreSQL/HTTP workflow tests and four-role Chrome evidence; wider workflow and acceptance items remain visible in the full frontend scope catalogue.

## Clinical workspace overview follow-up — 2026-10-15

The overview now brings clinical documentation, treatment, investigations, recent problems, patient documents and encounter history into the main workspace. Identity and allergy context share one sticky container; the existing global sidebar is unchanged. The current outpatient encounter includes recorded progress, next workflow step, assignment context, presenting complaint from readable encounter notes, and permission-aware links to encounter-specific notes, treatment and orders. Own drafts remain visibly unsigned. Note saves refresh encounter documentation.

Blood pressure is combined only when both values have the same non-null encounter, timestamp, source and unit. Different or incomplete measurements remain separate; absent patient-specific ranges do not become inferred normal/abnormal labels. Two focused tests cover pairing and mismatched provenance. The scoped observation projection now includes encounter identity; no migration is required.

Verification: API/web/client TypeScript checks, frontend lint, eight frontend tests, normal localhost:3001 nurse chart plus eight scoped history routes, and headless Chrome desktop/mobile hydration, viewport fit and sticky context. Browser captures are under ignored tmp/patient-workspace-evidence.

Still required for the wider clinical workspace: patient-specific observation thresholds, complete active inpatient/emergency context, named care-team summaries, secure staff-facing referral/insurance read projections, consent-governed cross-facility history, anatomical encounter tooling, prescribing/order composition, diagnostic results/report review and full nursing/eMAR actions. Existing legacy referral/insurance endpoints are not automatically exposed through the staff web session; they need patient/facility and domain-permission review first. This follow-up does not mark those workflows delivered.

### Reference-aligned visual refinement

The patient overview now follows the supplied EHR reference more closely: compact identity banner, horizontal safety/context tiles, an ordered seven-metric vitals strip (missing readings explicitly marked), icon-led clinical headings, aligned three-column summary cards, timeline treatment and a narrow right column with registration details, documents and quick access. Existing sidebar and clinical permission rules are preserved. Mobile reduces the summary grid and stacks panels; medication and condition tiles navigate to their existing scoped records rather than showing invented summary counts. Empty histories retain clear missing-data wording. Desktop/mobile Chrome screenshots and navigation were reviewed alongside successful frontend type/lint checks and eight regression tests.

### Patient header refinement

The header is now a dedicated PatientRecordHeader component with scoped styling: circular initials avatar, inline active/merged badge, separated demographic line, facility and outpatient visit context, an Actions disclosure and aligned safety tiles. Visit status is sourced from the scoped current-visit API; medication text comes from the readable recent prescription page and explicitly identifies its bounded scope. Allergy and condition summaries remain bounded and distinguish unconfirmed or restricted information. The Actions menu supports keyboard disclosure, Escape, outside-click dismissal and permission-aware chart navigation. The reference's patient photograph and insurance/alert values are not fabricated. Browser checks cover desktop/mobile fit, persistent context and header-menu navigation; type/lint checks pass. This pass changes the header only, retaining the existing overview content and sidebar.

### Chart viewport and sticky-header density

Reduced the breadcrumb/refresh row, tab heights and expanded banner spacing. An IntersectionObserver on a stable sentinel before the header switches the sticky card to a compact identity/allergy bar after scrolling; the full banner returns at the top. Name, MRN, age, sex and recorded allergies remain visible, while noncritical context and medication/condition tiles scroll out of the compact presentation. ResizeObserver keeps the tab offset aligned with the actual header and global toolbar heights. The sentinel is independent of the resized header to avoid collapse/expand oscillation.

Local Chrome checks at 1440x768, 1366x768 and 390x844 verified expansion restoration, no horizontal overflow, sticky context, menu keyboard/navigation behavior and a compact header below 130px. Measured compact headers: 88px desktop and 107px mobile; the chart begins below the sticky controls at approximately 200px desktop and 268px mobile. Evidence remains under ignored tmp/patient-workspace-evidence. TypeScript and frontend lint pass.

### Current encounter card refinement

The current outpatient encounter follows the reference's compact clinical hierarchy: icon/title with OPD and recorded stage badges, visit date/time, side-by-side presenting complaint and encounter progress, care assignment context, a concise next step and an action row. Presenting complaint comes from readable encounter notes, preferring consultation context and identifying own drafts as unsigned. The progress display reflects actual visit stages, including completed vitals while awaiting handoff; no order/completion step is inferred from note signing. Nursing vitals/handoff and clinician documentation/start actions retain their existing permissions and drawers. The chart's redundant Open chart link is suppressed through an optional VisitActions prop; worklist links retain their default behavior. No-active-visit, loading and retryable service errors have distinct states.

Checks: frontend type/lint, eight frontend regression tests, normal local empty-visit rendering, and a browser-only active-visit fixture at desktop/laptop/mobile widths, including stage rendering, completed check-in, the vitals drawer and preserved compact sticky header. The fixture intercepts read responses only and writes no clinical records; it is visual/interaction evidence, not a database workflow regression. Existing backend workflow tests remain the evidence for the underlying mutations.

### Latest vital signs refinement

Replaced the inline vitals panel with LatestVitalSigns: a compact seven-metric strip with individual clinical icons, prominent recorded values and units, subdued missing states and a latest-entry timestamp. Mobile uses a wider blood-pressure tile followed by two-column measurements. Matching systolic/diastolic readings still require identical non-null encounter, timestamp, source and unit; unmatched readings remain separate. Different recording times are identified on the strip and the footer. Full timestamps, recorded units and source remain in expandable measurement details, including observations outside the seven primary metrics. No normal/abnormal classification is inferred without patient-specific ranges. Restricted data remains a distinct permission state.

Verification: frontend type/lint, eight regression tests including blood-pressure provenance checks, and local Chrome checks at laptop/mobile sizes. Browser checks exercise seven metric slots with real demo heart-rate data, collapsed/expanded provenance details, navigation to vitals history, and preservation of compact sticky patient context. No clinical observations were created or modified.

### Server-derived vital screening and semantic warning pills

The scoped chart API now attaches versioned positive-screening assessments to each readable observation. The first adult rules cover systolic/diastolic BP (high at 140/90 mmHg; severe at 180/120 mmHg, either component independently) and temperature (high at 38 C, with supported Fahrenheit conversion). Assessment uses age at measurement, validates numeric values/units/timestamps and declines paediatric, unsupported or missing inputs. These are screening signals, not diagnoses, emergency classification or treatment advice. Values below these high thresholds are labelled No high flag, never Normal; low values, pregnancy-specific targets, paediatric protocols, oxygen targets and other clinical risks are not assessed by this baseline.

The vitals strip displays red Severely high and amber High BP/High temperature pills, tinted metric surfaces, an icon/text review count and neutral Not assessed states. Paired BP retains the stronger component flag; unmatched recording contexts remain separate. Expandable details show the reason, source guidance and rule version (adult-screening-2026-10-15.v1). Read-time assessment does not alter observations, create notifications or claim acknowledgment. No demographic or measurement data is transmitted to external guidance sites unless the user opens their static reference links.

Reference guidance: https://www.nice.org.uk/guidance/ng136/chapter/recommendations and https://www.nhs.uk/symptoms/fever-in-adults/ . Production deployment defaults to disabled until clinical governance validates/adopts the rules; explicit PULSE_VITAL_SCREENING_ENABLED=true enables them. Development/test defaults on; explicit false disables screening. Broader facility/patient-specific rule configuration, clinical approval/version lifecycle, lab-result publication/flags, escalation and acknowledgment remain in their owning scope.

Verification: seven server-rule tests, seven scoped PostgreSQL/HTTP chart tests (including severe systolic with lower diastolic, high temperature, unsupported HR and access restrictions), nine frontend tests (including isolated diastolic flag preservation), API build, type/lint checks and browser checks. The actual vitals component was rendered with server-assessed synthetic readings to verify red/amber labels, measurement details and desktop/mobile fit without writing clinical data. Evidence: ignored tmp/vital-flags-preview. Normal local chart/history/disclosure checks remain green.

### Expanded physiological assessment — 2026-10-15

Adult screening v2 adds respiratory rate, pulse and oxygen saturation component references from the RCP NEWS2 guidance. These are individual review signals, not a total NEWS2 score, a diagnosis, treatment instruction or a modified NEWS2 chart. The strip displays reference bands for supported rates and the default adult SpO2 Scale 1 reference. Clinician-prescribed oxygen target capture/override, oxygen support and confirmed hypercapnic status are not yet modelled in this staff chart; default saturation flags explicitly identify that limitation. Pregnancy and paediatric profiles remain separate. Existing deployment enable/disable behavior is preserved.

A server-side derived projection now supplies BMI and general-adult BMI categories, Mosteller BSA, Janmahasatian estimated lean mass, pulse pressure and approximate MAP. Each calculated item retains formula/version, source observation IDs, measurement time, reason and reference URL. Estimates are labelled; no universal normal bands or automatic drug doses are invented for body surface area, lean mass, pulse pressure or MAP. BMI uses unrounded calculation for classification and discloses that basis; ethnicity-specific bands, pregnancy, oedema and muscularity need clinical interpretation. The lean estimate needs recorded male/female sex; no formula selection is inferred for other/unknown values.

Combined calculations require matching non-null encounter, exact time and recording source, supported units, positive finite inputs and adult age at measurement. kg/lb and cm/m/in inputs are normalized for body calculations; BP requires mmHg and systolic greater than diastolic. Missing/incompatible inputs produce a reason, not a guessed result. Unavailable calculations are progressively disclosed to preserve chart density. No migration or synthetic demo-care data is added.

Verification: 13 server-rule/calculation tests, seven PostgreSQL/HTTP scope/projection tests, nine frontend regressions, API build, web/API/client type and lint checks and module-boundary checks. Browser evidence renders the actual vitals component using server-assessed synthetic measurements at desktop/laptop/mobile sizes, exercises formula/flag details and confirms normal local chart behavior; evidence remains ignored under tmp/vital-flags-preview and tmp/patient-workspace-evidence. The disposable verification database was stopped afterward.

References: RCP NEWS2 https://www.rcp.ac.uk/media/ctulqqbn/news2-executive-summary_0.pdf ; NICE NG246 https://www.nice.org.uk/guidance/ng246/chapter/Identifying-and-assessing-overweight-obesity-and-central-adiposity ; Mosteller https://pubmed.ncbi.nlm.nih.gov/3657876/ ; lean-mass validation https://pmc.ncbi.nlm.nih.gov/articles/PMC3833312/ ; MAP estimation https://pubmed.ncbi.nlm.nih.gov/32694334/ .

### Problems, treatment and investigation cards

The three generic previews are replaced with dedicated, aligned summary cards. Problems exclude allergy entries and offer Active/Resolved/All views; dates are labelled recorded rather than inferred onset. Current/Past/All treatment filters show dose, route, frequency, held status/reason and available recent administration records. Prescription status never implies a dose was given. Investigation Recent/Pending/Available views show actual order states and available verified lab/final imaging findings, including recorded critical/high/low flags. Full history exposes the same safe findings through shared rendering.

Filters/counts apply to the loaded history page; the footer identifies the latest-25 bound when further records exist. Up to three matching records appear, prioritizing critical/abnormal findings and held medication within that bound. Empty, restricted, loading and failure/retry states are separate; view-all/review links lead to scoped history. No diagnosis, prescribing or ordering composer is fabricated by this refinement. Those write workflows remain in their owning scope.

Publication controls and follow-on diagnostic scope are recorded in SPRINT_W06.md. Browser-only populated fixtures cover diagnosis/resolved filters, allergy exclusion, current/past/held treatment, available investigations, critical result expansion, laptop/mobile fit and existing header/menu navigation. Normal local empty-card behavior also passes. Clinical sample records were not added to the demo database.
