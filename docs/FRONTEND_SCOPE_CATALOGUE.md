# Pulse frontend functional scope catalogue

Version: 2 — 13 October 2026. Companion to [the delivery plan](FRONTEND_DELIVERY_PLAN.md). Source section index: [FRONTEND_SOURCE_COVERAGE.csv](FRONTEND_SOURCE_COVERAGE.csv). The index inventories source sections; it does not certify implementation or legal/clinical acceptance.

## Scope rules

This catalogue scopes the **whole documented product**, including functionality absent from today's backend. Missing APIs are dependencies, not reasons to omit a screen or claim a feature is complete. All entries are **planned**, with contract readiness to be established before implementation. Historic backend sprint completion remains independent.

Each row is a capability/workflow group, not necessarily a separate page. It may require a worklist, detail, form, review, history, exception and configuration surface. The 87 existing UX screen IDs are mapped separately in [FRONTEND_UX_SCREEN_MAP.csv](FRONTEND_UX_SCREEN_MAP.csv); the UX catalogue is a minimum and is extended here wherever domain specifications require more.

Scope dispositions:

- **P — Product:** required frontend workflow when the associated facility capability is enabled.
- **C — Conditional extension:** explicitly described specialist/advanced/vendor-dependent capability. Retained in scope with an activation prerequisite; not promised in the first pilot.
- **E — External boundary:** authoritative tool/runtime/process belongs outside the frontend. Pulse still provides authorized status, handoff, failure and evidence views where useful. Do not rebuild PACS, analyzers, payroll, national registries, infrastructure orchestrators or a general accounting system.
- **Q — Quality/control:** mandatory behavior or verification across relevant screens, not an optional standalone module.

Every consequential action has server authorization, correct identity/facility/encounter, actor/time/source, durable result, reason where required, retry/version handling and all relevant UI states. Every row requires role-specific access and permission-denied behavior, bounded reads, loading/empty/unavailable/stale/conflict states, accessibility and responsive design. Do not interpret the compact descriptions as permission to omit these common requirements.

Brand images are **quality and direction references**, not final approved designs or exact layouts. The user's clarification takes precedence over earlier wording about the mockup being a visual target. Final information architecture, navigation, density and interactions must follow real role journeys and be validated with users.

## FND — Entry, shared shell and identity assurance

Sources: FE-001 §§3,7–14,20–31,54–79; UX-001 §§3–34,58–80; IAM-001 §§8–11,31,38,54–57; SEC-001 §§22,34. Bands W01/W02, with shared behavior in every band. Primary users: all staff; patient equivalents in PAT.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| FND-01 | Staff sign-in, MFA challenge, error/rate-limit feedback, supported assurance methods | P; trustworthy session/BFF and backend auth |
| FND-02 | MFA enrolment, confirmation, factor recovery, recovery-code handling, credential change/reset | P; identity verification and security contracts; do not display unsupported recovery |
| FND-03 | Enterprise SSO and approved badge/Smart Card/hardware-key/device authentication entry | C; federation/device adapter and assurance policy |
| FND-04 | Authorized organization/facility/workspace selection; department/unit/assignment context where applicable | P; membership/capability discovery and revalidation |
| FND-05 | Profile/security centre: active sessions/devices, revoke other sessions, idle/absolute timeout, sensitive-action reauthentication | P; session/device inventory and revocation APIs |
| FND-06 | Shared-workstation lock, safe switch-user, identity recovery; no prior user's chart/cache remaining | P; explicit draft/cache and workstation policy |
| FND-07 | Global capability-driven shell, contextual navigation/breadcrumbs, help/profile/work/notification entries | P; actual routes/capabilities rather than static broad role labels |
| FND-08 | Role homes for clinician, nurse/midwife, lab, radiology, pharmacy, front desk, referral desk, finance/stores, HOD, admin and executive | P; scoped actionable queues/counts, freshness and drill-through |
| FND-09 | Global patient search, cancellable typeahead, recent patients visibly separate, keyboard shortcut/help, minimum-necessary results | P; exact identifier priority and authorized results |
| FND-10 | Persistent patient/encounter/facility banner, safety flags, explicit context switching, high-consequence target confirmation | Q; unknown data remains unknown; tablet/phone identity preserved |
| FND-11 | Break-glass request, reason/scope/time/step-up, prominent active state, expiry/end and review handoff | P; clinical eligibility and audited server grant; never admin/financial bypass |
| FND-12 | Search/filter/sort/pagination, saved role views, return-to-worklist context and safe deep links | P; bounded server queries and safe opaque routing |
| FND-13 | Connectivity/API/dependency/edge-sync indicators, freshness, maintenance notices and degraded-capability explanation | Q; distinguish browser connection from backend and sync health |
| FND-14 | Dirty-form navigation/context protection, draft status, timeout recovery, conflict reconciliation, unknown-write recovery | Q; versioned drafts and approved sensitive-storage policy |
| FND-15 | Facility/user timezone, date-only vs instant, clinical effective vs recorded time, locale/currency/units and language readiness | Q; governed configuration; no browser-only clinical assumptions |
| FND-16 | Help, shortcut guide, contextual training, release notes, unsupported-browser/device guidance and clearly marked synthetic training mode | P; maintained content and certified device/browser policy |

## IDN — Patient identity, registration and records management

Sources: Blueprint §4; CLIN-001 §§4,12,27; BACKLOG-001 F04.1–5; IAM-001 §§19,24–25; DB-001 §§11–13; MIG-001 §§13–17. Band W03 and specialist identity paths W19. Primary users: records/front desk, authorized identity reviewers, clinical staff.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| IDN-01 | Search/registration worklist, exact MRN/identifier namespaces, demographic disambiguation and identifier issuing | P; verified facility scoping and registration idempotency |
| IDN-02 | Legal/preferred name, DOB/estimated DOB, sex, contact/address, optional nationality, language/accessibility needs | P; expanded demographic contract; no guessed defaults |
| IDN-03 | Next-of-kin/emergency contact/guardian/related person and communication preferences | P; contact relationship does not grant portal/chart access |
| IDN-04 | Payer/member coverage capture, guarantor, encounter coverage selection and verification handoff | P; IDN/REV integration; patient identity stays independent |
| IDN-05 | Demographic/identifier correction, history, conflicting identifiers and downstream reconciliation status | P; version/audit and governed correction contract |
| IDN-06 | Duplicate candidate review, comparison, survivor selection, privileged merge request/approval and exact impact preview | P; never automatic similarity-based merge |
| IDN-07 | Merge history, retired-ID redirect, erroneous-merge investigation and governed unmerge/correction | P; dedicated correction semantics; no casual undo of clinical history |
| IDN-08 | Provisional/unknown emergency identity, later reconciliation, aliases and brought-in-dead identity handling | P; emergency minimum-safe identity APIs |
| IDN-09 | Chart overview: active encounter, problems/allergies, medications, vitals, pending/critical results, care team/tasks/documents | P; screen-sized projection and known/unknown safety data |
| IDN-10 | Chronological and problem-oriented longitudinal record, encounter filters, source/version/correction links | P; clinical effective time and externally sourced content explicit |
| IDN-11 | Governed patient photograph, historical/imported identity and legacy read-only record access | C; lawful basis/storage; legacy provenance and read-only labeling |
| IDN-12 | Record-copy requests, identity dispute/correction routing, restricted-record access and wrong-patient incident escalation | P; PRIV/ADM workflows; no drag-and-drop signed facts between patients |

## SCH — Scheduling, arrival and patient flow

Sources: Blueprint §5; CLIN-001 §§5–6,18,22; UX-001 §56; BACKLOG-001 F05.1–4; ONB-001 §48. Band W04; recurring and specialty extensions W19/W20. Primary users: front desk, scheduler, clinician/nurse, bed/resource coordinators.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| SCH-01 | Day/week/range calendars by provider, service, specialty, facility, room/resource | P; schedule/availability/detail APIs |
| SCH-02 | Slot templates, recurring clinics, capacity/overbook rules, blackouts/holidays and equipment-aware availability | P; versioned scheduling configuration |
| SCH-03 | Book from staff, referral, follow-up or walk-in; portal booking handled under PAT; confirmation/preparation | P; source and patient/encounter distinction preserved |
| SCH-04 | Arrival/check-in, triage routing, called/in-service/completed states, acuity/priority and responsible staff | P; queue context and server transitions |
| SCH-05 | Re-triage, wait-time/ageing/overdue queue, department movement and public display with minimal identity | P; retain reassessment history; no hidden overdue defaults |
| SCH-06 | Cancel/reschedule/no-show/left-early with reasons, old/new appointment history, resource release and follow-up | P; explicit reason/linkage contracts |
| SCH-07 | Reminder/preparation communications, consent/preferences and delivery exceptions | P; workflow/provider integration; delivery is not clinical acknowledgement |
| SCH-08 | Recurring series and session deferral/missed/reschedule history | P; program/version linkage, not disconnected appointments |

## CLN — Encounter, documentation, care coordination and follow-up

Sources: Blueprint §§6,23; CLIN-001 §§7,15,18–27; UX-001 §§36–43,85; IAM-001 §§46–48; BACKLOG-001 F06/F08/F09. Bands W05/W06, with transitions and specialty elements W08/W19/W20.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| CLN-01 | Encounter create/list/detail/history, outpatient/emergency/inpatient types, open/historical/closed context | P; patient/facility/resource consistency; appointment is not encounter |
| CLN-02 | Responsible clinician/team, care assignments, specialty/service ownership, cross-cover and pending responsibilities | P; IAM/roster/care relationship contracts |
| CLN-03 | Consultation: complaint, HPI, medical/surgical/obstetric/family/social history, examination, assessment/differential/plan | P; structured/narrative fields and approved templates |
| CLN-04 | Draft create/read/edit/save, permitted autosave, dirty/version/conflict status and safe recovery | P; draft update/version API before autosave |
| CLN-05 | Review/sign/co-sign, trainee/supervisor queues, content review and attributable author/signer | P; clinical privilege and supervision authority; signature is deliberate |
| CLN-06 | Signed view, addendum/amendment/entered-error/dispute and complete original/version/reason history | P; no destructive signed update |
| CLN-07 | Problem/diagnosis record: coded/free-text permitted data, certainty/verification, onset/status and linked care history | P; clinician meaning not changed for billing |
| CLN-08 | Allergy/intolerance: substance/reaction/severity/source/verification, unknown vs NKA/NKDA and governed correction | P; safety prominence in prescribing/verification/administration |
| CLN-09 | Generic order composer: catalogue/code/display, indication, priority, site/laterality/specimen, favorites/order sets and final review | P; type-specific domain contracts; no ungoverned order-set defaults |
| CLN-10 | Order worklist/detail/cancel/hold/correction, duplicates/prerequisite warnings and status history | P; consequential state/cancellation reasons; linked resource consistency |
| CLN-11 | Clinical result-review queue, historical/trend/report review, acknowledgement and action/communication/follow-up task | P; independent from finalization and persists after discharge |
| CLN-12 | Internal consult request/review/accept/assign/opinion/recommendation/lead-team acknowledgement and escalation | P; consultation does not silently transfer primary care |
| CLN-13 | CarePlan/Goal/EpisodeOfCare: patient-specific goals, interventions, due/review tasks, progress, version and ownership | P; program and canonical patient model |
| CLN-14 | Procedure documentation outside theatre: consent/site/laterality, findings/specimens/consumables/complications and note | P; procedure domain contract with MED/INV/LAB links |
| CLN-15 | Clinical task inbox/team assignment, priority/due/escalate/delegate, completion/exception evidence | P; reading a message is not completing the task |
| CLN-16 | Deterioration/rapid response: triggering observations/score/source, acknowledge/respond/escalate/disposition history | P; approved rules, separate acknowledgement and clinical response |
| CLN-17 | Discharge summary, diagnoses/procedures/key results, reconciliation, pending-result owner, instructions/red flags and follow-up | P; clinical disposition independent of financial settlement |
| CLN-18 | Outpatient closure/incomplete visit, counseling, return precautions and pending-work continuity | P; closing encounter cannot silently close unresolved critical work |
| CLN-19 | Informed refusal/DAMA: capacity/proxy context, discussion/risks/alternatives, acknowledgment/refusal-to-sign and specific disposition | P; approved facility/legal workflow and non-stigmatizing copy |
| CLN-20 | Death/end-of-life/DOA: authorized confirmation, disposition, mortuary/admin handoff, future-task/reminder suppression | P; preserved history, dignity and no automatic death inference |
| CLN-21 | Wrong-patient content suspicion, controlled investigation, downstream impact/notifications and governed correction | P; audit/incident workflow rather than moving signed records |
| CLN-22 | Patient-facing visit instructions, clinical messages, contact/outreach attempts and result-release policy | P; purpose/recipient verification and separate patient-readable view |

## NUR / ADT — Nursing, wards, bedside and inpatient movement

Sources: Blueprint §§8,13; CLIN-001 §§6,13–14,18,21; UX-001 §§44–47,86; MED-001 §§26–31; Sprint 37 bedflow. Band W08 and bedside W21. Primary users: nurse/midwife, ward lead, bed manager and authorized admitting/discharging clinicians.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| NUR-01 | Ward board/assigned patients/bedside summary, acuity, isolation/fall/other approved flags, overdue tasks and care team | P; live assignments and responsive persistent context |
| NUR-02 | Nursing admission/shift assessment, care plan, pain/risk scores, notes and escalation | P; configured instruments with source values and no false normal defaults |
| NUR-03 | Vitals/observations/flowsheet/trends: value/unit/effective time/source, manual/device entry, correction and repeat | P; original values retained; scores do not replace judgment |
| NUR-04 | Intake/output, fluid balance, wound/device/line/drain and specialty bedside charts | P; structured measurements and accountable event times |
| NUR-05 | Observation schedules/due/overdue, nursing tasks, escalation/response and assigned owner | P; approved scheduling and alert-fatigue controls |
| NUR-06 | eMAR bedside presentation, patient/product verification, due doses, omissions/holds, witness and response | P; shared medication authority; see MED scope |
| NUR-07 | Shift/service handover review, editable authored summary, risks/pending work, receiving acknowledgement and unanswered items | P; review/acceptance not auto-generated completion |
| NUR-08 | Safety event/near-miss reporting, downtime artifact capture and post-recovery reconciliation | P; GOV/OPS workflows and retrospective provenance |
| ADT-01 | Admission request/review/accept, service decision, clinical reason/readiness and waiting/escalation | P; separate admission order and physical arrival |
| ADT-02 | Bed board/search/reserve, available/occupied/reserved/cleaning/maintenance/isolation states | P; concurrency and facilities/ward suitability rules |
| ADT-03 | Pre-arrival handover, arrival/identity check, receiving care acceptance, baseline assessment and active ward stay | P; reservation is not admission/assumption of care |
| ADT-04 | Internal ward/service transfer: destination readiness/reservation, dispatch/arrival, handover and ownership history | P; no gap in responsible team; pending meds/results move safely |
| ADT-05 | Discharge readiness/barriers, multidisciplinary planning, medication/pending-result continuity and bed release/cleaning | P; summary and signed clinical decision; checkout remains separate |
| ADT-06 | ICU/HDU level of care and assignment changes, acuity/monitoring/infusion links, transfer escalation | P when enabled; verified bedflow/ADT reconciliation |

## LAB — Laboratory and diagnostics

Sources: LAB-001 §§6–41,48–53; CLIN-001 §9; UX-001 §§49,87. Band W06, advanced lab and configured discipline extensions split into W06 sub-bands. Primary users: ordering clinician, collector, accession clerk, laboratory staff/validator/supervisor.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| LAB-01 | Test/panel search/catalogue admin: synonyms, components/reflex/calculated rules, methods, mappings/version/effective status | P; clinical catalogue distinct from billing catalogue |
| LAB-02 | Specimen/container/site/minimum volume/preparation/stability/temperature and patient collection instructions | P; explicit governed requirements |
| LAB-03 | Order/intake/detail, recurring/standing/add-on test, urgency, cancellation/modification/partial unresolved state | P; suitable specimen and signed-order constraints |
| LAB-04 | Collection queue, identity/label/container verification, collector/actual time, failure/defer/recollect and label reprints | P; barcode/printing peripherals optional with controlled fallback |
| LAB-05 | Receipt/accession, accept/conditional accept/reject, reason/affected tests/recollection task and original specimen history | P; chain of custody and lineage |
| LAB-06 | Aliquots/parent containers, dispatch/receive custody, courier manifests and exception investigation | P; C for validated pooling/forensic-specific extension |
| LAB-07 | Bench/instrument/discipline/urgency/ageing worklists, assignment, analytical run/batch and overdue flags | P; bounded filtered worklists cannot hide overdue work silently |
| LAB-08 | Manual/analyzer/calculated/transcribed/external result staging; numeric/coded/text/panel/narrative/attachment | P; source unit/value/time/operator and mapping quarantine |
| LAB-09 | Versioned contextual reference intervals, flags, unavailable context, precision/unit conversions and historical interval retention | P; no inferred diagnosis or silent conversion |
| LAB-10 | Technical/clinical validation: specimen integrity, instrument flags, QC, delta/plausibility, rerun/dilution/hold and reviewer | P; professional judgment and configurable authorized stages |
| LAB-11 | Approved auto-verification rules, eligibility/QC exclusions, rule version and manual fallback review | C; independently validated rules; not automatic analyzer publication |
| LAB-12 | Preliminary/partial/final/corrected report, component completeness, review/sign/amend/version/re-notify and print | P; release and clinical review are separate |
| LAB-13 | Critical-result workbench: responsible recipient, attempts/read-back, acknowledgment/escalation and subsequent clinical action | P; delivery/read is not acknowledgment |
| LAB-14 | Send-out/referral lab: partner selection, dispatch/transport/TAT, source report receipt/match/release and lost/cancel exceptions | P; external result remains source-labeled |
| LAB-15 | Microbiology culture stages, multiple organisms, susceptibility method/standard/version and critical/infection-control reporting | C; structured discipline extension and local public-health configuration |
| LAB-16 | Histopathology/cytology accession, specimen parts/blocks/slides, narrative/synoptic reporting and digital-pathology handoff | P minimum specimen/status/report; C for dedicated AP/digital pathology |
| LAB-17 | POCT device/operator/patient/QC/location workflow and offline reconciliation | C; validated device integration; manual provenance retained |
| LAB-18 | QC material/lot/run/ranges/status/corrective actions and release holds; analyzer mapping/maintenance/interface health | P oversight; E where LIS/middleware owns statistical QC |
| LAB-19 | Reagent/batch/expiry/recall-to-run trace, stock/test availability, charge reconciliation, downtime and correction cohort | P; INV/REV/INT owners remain authoritative |

## IMG — Imaging, radiology and PACS

Sources: IMG-001 §§6–39,44–51; CLIN-001 §10; UX-001 §§50,87. Band W06 imaging sub-bands. Primary users: scheduler, radiographer, radiologist, ordering/reviewing clinician.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| IMG-01 | Procedure catalogue/modality/body site/laterality/contrast/preparation/safety form/protocol and versioned mappings | P; approved imaging catalogue |
| IMG-02 | Order composer/priority/clinical question/priors, cancel/hold/entered-error, indication and laterality | P; mismatch and duplicate/recent-study workflow |
| IMG-03 | Modality/device/room calendar, urgent slots, preparation, downtime/sedation/escort resource dependencies | P; equipment-aware scheduling and reason history |
| IMG-04 | Protocol review: technique/sequences/coverage, contrast/renal/pregnancy/implant/age/prior-study context and author | P; professionally approved decisions and templates |
| IMG-05 | Identity, MRI/implant/metal, pregnancy/radiation, contrast/renal, sedation, infection/mobility/guardian screening | P; current attributable evidence, never prior scan implies safe |
| IMG-06 | Arrival/modality worklist/acquisition verification, site/markers, image receipt/completeness and exception status | P; E for DICOM services/modality runtime |
| IMG-07 | Study/series metadata, accession/UID/order association, unmatched/wrong-patient/duplicate/multiple-study reconciliation | P; authorized review; preserve source metadata |
| IMG-08 | Secure contextual PACS viewer launch/return, priors and textual report fallback with authorized access | P; adapter; E for diagnostic pixel archive/validated viewer |
| IMG-09 | Reporting workbench/template/dictation draft/findings/impression/comparison/recommendations, preliminary/final/sign/amend | P; speech output draft until signed; versioned interpretations |
| IMG-10 | Critical finding contacts/read-back/acknowledgment/escalation and overdue follow-up recommendation tasks | P; acknowledgment separate from final report, viewing and action |
| IMG-11 | Contrast product/dose/route/lot/admin/reaction treatment and future allergy/incident handoff | P; MED/INV record authority |
| IMG-12 | Radiation-dose metadata/source units and authorized quality view | C; modality-provided data, no unsupported clinical interpretation |
| IMG-13 | Interventional imaging consent/procedure/site/specimens/devices/consumables/recovery links | P when enabled; procedure/theatre boundary |
| IMG-14 | External study/report import/source match, patient-provided report, secure image exchange and local reinterpretation | P; original source report preserved; E for PACS import tools |
| IMG-15 | Imaging supervisor backlog/TAT/availability, viewer/PACS outage and acquisition/report reconciliation | P; truthfully unavailable vs no study |

## MED — Medication, pharmacy and eMAR

Sources: MED-001 §§6–43,50–56; Blueprint §11; UX-001 §§42–43,51,88. Band W07 split by reconciliations, prescribing, pharmacy and scheduled administration. Primary users: prescriber, pharmacist, nurse/qualified administrator and controlled-drug accountable staff.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| MED-01 | Medication/ingredient/generic/brand/strength/form/route catalogue; high-alert/LASA/controlled flags and terminology history | P; clinical concept separated from stocked product |
| MED-02 | Facility formulary/preferred/restricted/non-formulary/availability, allowed prescriber/indication and substitution policy | P; governed version/approval |
| MED-03 | Medication history/source/confidence; admission/transfer/post-procedure/discharge/outpatient reconciliation and discrepancy resolution | P; copied list is not reconciliation |
| MED-04 | Prescribe indication/dose/unit/route/start/duration/frequency/quantity/instructions and review/sign | P; structured schedule and privilege |
| MED-05 | Regular/specific times/interval/STAT/one-time/PRN dosing, indication/minimum interval/maximum/effect review | P; scheduled occurrence engine and overdue escalation |
| MED-06 | Infusion solution/concentration/access/rate/basis/bag/start/stop and attributable rate changes/monitoring | P for enabled inpatient scope; validated structured parameters |
| MED-07 | Taper/titration/cyclical phase plans and governed dose suggestions | C; professional confirmation; no autonomous closed-loop treatment |
| MED-08 | Allergy/interaction/duplicate/dose/route/form/renal/hepatic/pregnancy warnings, source/rule version and reasoned overrides | P configured validated rules; C for licensed drug-knowledge sources |
| MED-09 | Verification queue/detail: clinical review, clarification/rejection/conditional approval/emergency exception and pharmacist attribution | P; no verification inferred from dispense |
| MED-10 | Pharmacy intervention/message/prescriber response/recommendation/outcome/clinical significance record | P; original signed order retained |
| MED-11 | Dispense queue/product/quantity/days supply, batch/expiry/FEFO/labels, prepare/check/issue and destination | P; inventory ledger/stock availability and accountable checker |
| MED-12 | Partial dispense/outstanding supply, approved generic/brand/strength/therapeutic substitution and patient counseling | P; authorized equivalence and supplied product visible |
| MED-13 | Ward/satellite/emergency stock, patient bins/par levels, replenishment and emergency floor-stock reconciliation | P; linked but independent supply/admin/stock facts |
| MED-14 | Time-oriented eMAR/due/overdue/held/stopped occurrences, exact patient/medication/dose/time/route/site | P; full schedule/read contracts before claiming eMAR complete |
| MED-15 | Bedside actual administration/effective vs recorded time, witness/double check and PRN response | P; never pre-chart or infer from stock issue |
| MED-16 | Not-given refused/held/omitted/unavailable/NPO/parameter/absent reasons and accountable escalation | P; blank cell stays unrecorded/overdue, not a negative assertion |
| MED-17 | Barcode wristband/product/batch checks, mismatch/unscannable exception and scanner-failure manual workflow | C; peripheral/validated compatibility services |
| MED-18 | Controlled-drug receipt/issue/admin/return/waste/destruction ledger, witnesses and variance investigation | P when controlled stock enabled; SoD and immutable events |
| MED-19 | Order modify/replace/hold/resume/discontinue/entered-error, future schedule effect and preserved past doses | P; effective version and unknown-outcome reconciliation |
| MED-20 | Returns/wastage/expiry/destruction/recall patient exposure, quantity accounting and source issue/admin links | P; actual physical movement, not payment-driven fiction |
| MED-21 | Adverse drug event/reaction, suspected causality, allergy verification, medication safety/pharmacovigilance and monitoring tasks | P; clinician assessment and GOV links |
| MED-22 | Discharge/transfer patient-readable medicine list, continue/start/change/stop, last doses/infusions and receiving reconciliation | P; imported medicines not automatically active local orders |

## INV — Inventory, stores and procurement

Sources: INV-001 §§5–46,49–60; MED-001 §§24–25,32–34; ONB-001 §50. Band W13 sub-bands. Primary users: department requesters, stores, procurement, receiving, inventory controller and delegated approvers.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| INV-01 | Item/variant/serial master, UOM/pack/conversion version, supplier code mappings, storage/reorder/controlled requirements | P; no opaque unit assumptions |
| INV-02 | Location/custody hierarchy and stock dashboard: on-hand/available/reserved/quarantined/in-transit/on-order/expired | P; location/batch explicit; totals do not imply local availability |
| INV-03 | Batch/lot/manufacture/expiry/receipt-cost/status, FEFO and expiry blocking/near-expiry review | P; patient/procedure trace where captured |
| INV-04 | Immutable movement ledger/detail/source/destination/reason/actor/ref, reversal and investigation | P; no direct quantity-on-hand editing |
| INV-05 | Department requisition/approval/partial approval/reject/pick/partial fulfill/receive and outstanding demand | P; receipt evidence and authorized substitution |
| INV-06 | Par/min-max/consumption/scheduled/case replenishment, stockout/reorder/critical-item alerts | P; planning suggestions not stock movements |
| INV-07 | Purchase planning/requisition/budget/cost centre/priority/need date and delegated approval/return/amend | P; segregation of requester/approver/receiver/payer |
| INV-08 | Supplier onboarding/status/duplicate review/quality/lead time/contracts/documents and restricted payment details | P; block suspended supplier for normal new orders |
| INV-09 | RFQ/quotation normalized comparison/selection/award evidence | C; extended procurement; E for complex statutory tender platform |
| INV-10 | Purchase order/version/currency/terms/delivery/partial receive/close/cancel and approved amendments | P; PO is not received stock |
| INV-11 | Goods receipt/inspection/batch/serial/quantity/condition/PO reconciliation, short/excess/wrong/damaged/no-PO exceptions | P; accepted/rejected/pending quantities retained |
| INV-12 | Inspection/quarantine/release/return/destruction with authorized disposition | P; quarantined stock unavailable to normal issue |
| INV-13 | Store/inter-facility transfer dispatch/in-transit/partial receive/acknowledge/discrepancy | P; linked custody and no double available quantity |
| INV-14 | Patient/department/lab/theatre/general/emergency issue and consumption, actual vs expected usage | P; stock issue never proves clinical performance |
| INV-15 | Case/run/patient reservations, expire/release/pick, unused assessed returns | P; reservations distinct from physical stock movement |
| INV-16 | Returns/waste/write-off/expired/damaged/lost/controlled destruction approval and explicit ledger evidence | P; linked physical disposition and safety incident |
| INV-17 | Blind/full/cycle/spot count scope/freeze/snapshot/recount/investigate/approve/post variance | P; transactions during count reconciled, history retained |
| INV-18 | Recall case/quarantine/intercept/department/patient exposure/tasks/quantity closure | P; cross-links to dispense/implants/results |
| INV-19 | Lab reagent lot/run/QC, medication products/dispense, case carts/implants/serials and equipment commissioning links | P; each owning domain remains authoritative |
| INV-20 | Costing/value/cost centre, forecast/stock risk/supplier metrics, three-way-match evidence and finance reconciliation | P views; C forecasts; E accounts-payable/general-ledger execution |

## REV — Cashiering, patient accounts, insurance and financial control

Sources: REV-001 §§5–55,59–67; CR-001/ADR-007; BACKLOG-001 F14; UX-001 §§54–55,90. Bands W11/W12 with explicit sub-bands. Primary users: front desk, cashier, billing, insurance/claims/coding, credit/remittance, finance and tariff administrators.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| REV-01 | Financial service master and tariff versions by facility/payer/plan/class/effective date/UOM, mappings and restricted override | P; pinned historical price and explainable resolution |
| REV-02 | Payer/plan/contract/member/coverage/guarantor and multiple coverage priority/coordination | P; financial responsibility separate from legal identity/proxy |
| REV-03 | Eligibility evidence/reference/limitations/date-of-service mismatch and manual/API verification | P; eligible does not guarantee payment |
| REV-04 | Preauthorization request/partial approval/denial/info chase/expiry/units used/service limits/emergency exception | P; order/care remains independently truthful |
| REV-05 | Estimates/version/validity/assumptions/uncertainty, patient vs payer responsibility and acknowledgment | P; estimate not invoice |
| REV-06 | Deposit/prepayment/unallocated credit, later invoice allocation, carry/refund and receipt | P; derived balance, no direct wallet editing |
| REV-07 | Source-linked charge candidates/post/review/invoice, tariff gaps, manual override/approval and duplicate prevention | P; correct clinical/inventory event policy and idempotency |
| REV-08 | Bundles/packages/case rates/per-diem/inclusions/exclusions/outliers, charge reconciliation | C; full pricing model; capitation/bundles remain outside CR-001 initial insurance phases |
| REV-09 | Invoice draft/review/final/reissue/void/credit, totals/tax/discount/payer splits/deposits and patient statements | P; exact currency arithmetic and original lineage |
| REV-10 | Discount/waiver/exemption/financial assistance approval/evidence/limits, private socioeconomic documents | P; not presented as payer payment or deletion |
| REV-11 | Till/session/opening float/cash point/device, payment entry/change/overpayment policy and safe shift handover | P; delegated permissions and controlled receipt sequence |
| REV-12 | Cash/POS/bank/online/USSD/cheque/configured payment, pending/confirmed/failed external references and unknown outcome | P; E for gateway/processor execution; no false receipt before confirmed |
| REV-13 | Payment allocation across invoices, deposit/suspense, reallocation/unwind and gross-vs-settlement distinction | P; no duplicate provider callback effect |
| REV-14 | Receipt/statement/reprint with controlled number, source/channel/time and print audit | P; reprint never creates a new payment |
| REV-15 | Refund/reversal/chargeback/credit note/debit/write-off/correction approval, amount/method/reason and reconciliation | P; payment and clinical facts retained |
| REV-16 | Claim build/line coding/diagnosis/source/auth/attachments/validation and clinician coding query | P; no upcoding or changing clinical diagnosis for reimbursement |
| REV-17 | Idempotent claim submission/version/payload/acknowledgment, manual portal/batch/API/EDI channel evidence | P workflow; C/E for payer adapters/certification |
| REV-18 | Line adjudication/partial repricing/residual responsibility/info request, denial category/owner/deadline, appeal/resubmit history | P; payer denial does not erase service |
| REV-19 | Remittance line matching/payment reference/underpayment/unmatched amount/withholding and settlement reconciliation | P; backend/remittance contracts still required |
| REV-20 | Corporate sponsor/contracts/eligibility/credit limits/periodic statement/disputes and account allocations | P when enabled; legal issuer/entity explicit |
| REV-21 | Receivables aging/contact/dispute/approved write-off/payment plan/installments/assistance | P; legally/policy-approved terms, care status independent |
| REV-22 | Cash/bank/gateway daily close/count/variance/approval, period locks and controlled post-close adjustments | P; cashier cannot self-approve material variance |
| REV-23 | Revenue-integrity queues: unbilled/unpriced/duplicate services, expired auth, unsubmitted claims, unallocated/unmatched payments | P; owner, due time and clinical/stock reconciliation |
| REV-24 | Multi-facility legal-entity financial views, payer mix/service-line metrics and finance/ERP export | P views; E general ledger/payroll/banking product |
| REV-25 | Benefit determination: deductible/member-year usage, copay/coinsurance/limits/exclusions, patient-payer-guarantor shares and explainable calculation | P; ADR-007/CR-001 benefit contracts; pinned rule/tariff, exact allocation invariant and ambiguity review |

## REF — Pulse Connect, consented exchange and responsibility transfer

Sources: REF-001 §§5–33,40–53; CLIN-001 §17; PRIV-001 §§17–18,44; UX-001 §§53,67,89. Band W15 sub-bands. Primary users: referring/reviewing clinicians, coordinators, sender/transport/receiver and network administrators.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| REF-01 | Incoming/outgoing/urgent/overdue workspaces, owner/reassignment/review claim and case timeline | P; authorized case-scoped record visibility |
| REF-02 | Destination/service/provider directory, geography/hours/referral criteria/capability/network participation | P; published capability does not guarantee available capacity |
| REF-03 | Capacity/readiness signals for beds/ICU/theatre/dialysis/equipment/specialists with timestamp/confidence/reservation | C; receiving-facility authority and expiry/reconfirmation |
| REF-04 | Referral draft/type/urgency/question/diagnoses/current care and emergency minimum dataset with later additions | P; urgency-aware validation and provisional identity |
| REF-05 | Package preview/minimum-necessary resource selection, exact versions/hash/manifest, purpose/recipient and consent/basis | P; sensitive segmentation and original disclosure retained |
| REF-06 | Submit/delivery/acknowledge/retry/failure/external fallback evidence | P; never claim delivered from local submit alone |
| REF-07 | Receive/match/case-scoped review, authorized reviewer, local MRN mapping/uncertainty and original source identifiers | P; incoming record not silently merged or locally verified |
| REF-08 | Specific information requests/due owner/reply/unavailable response/new package version and escalation | P; unavailable information distinct from ignored request |
| REF-09 | Accept/conditional accept/decline/redirect, service/team/entry point/resources/validity/preparation and reason | P; authorized clinical decision, lineage and safe alternative |
| REF-10 | Transfer plan/stability/oxygen/monitoring/escort/infusions/equipment/departure/ETA and readiness checklist | P; no autonomous ambulance dispatch inferred |
| REF-11 | Dispatch/in-transit updates/contingencies/emergency capacity failure and responsible-team visibility | P; explicit governed transport responsibilities |
| REF-12 | Arrival/identity/handover reconciliation/local encounter/admission and explicit care assumption | P; accepted, arrived and care-assumed remain separate |
| REF-13 | Secure case thread/participants/attribution/resources/tasks, urgent message and disclosure history | P; read receipt not acceptance/acknowledgment |
| REF-14 | Outcome/continuity summary/results/medication changes/pending ownership/return referral and closure | P; receiver provenance cannot overwrite sender clinical facts |
| REF-15 | Cancel/expired acceptance/no-show/declined/lost-to-follow-up/duplicate linkage/outreach and closure reasons | P; safety-critical unresolved requests cannot silently close |
| REF-16 | Non-Pulse recipient portal/link/adapter and patient travel/preparation/status view | C; separate identity/trust/disclosure/expiry; see PAT/INT |
| REF-17 | Network participant onboarding/service publication/data-sharing agreements/routing ownership/suspension/offboarding and emergency contact readiness | P; legal/technical trust and INT/GOV governance; no unrestricted cross-facility visibility |

## ANAT — Anatomical clinical mapping

Sources: ANAT-001 §§5–25,31–44; Blueprint §7; UX-001 §39. Band W18, with explicit ANAT-0–6 technical and specialist stages. Primary users: clinicians, authorized patient educator, model/terminology reviewer.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| ANAT-01 | Model/profile catalogue/adult/sex/age/specialty choice, licensed version/manifest/checksum/status and historical assets | P general baseline; C specialty/age models |
| ANAT-02 | System/region/structure/substructure/landmark/layer navigation, synonyms/search and terminology mapping status | P; stable semantic ID independent of graphics |
| ANAT-03 | 2D/text alternatives and 3D viewport rotate/pan/zoom/isolate/hide/layer/search/select | P 2D/text and approved general 3D; C explode/cross-section if assets support |
| ANAT-04 | Finding type/laterality/severity/certainty/onset/duration/status/effective time/narrative and semantic review | P; laterality never derived from camera side |
| ANAT-05 | Point/line/polygon/area/path/brush draft annotations, model-space coordinates and geometry corruption recovery | P basic point/area; C validated additional geometry/volume tools |
| ANAT-06 | Length/width/depth/area/angle/circumference/count/% measurements, units/method/manual-vs-derived version | P governed measurements; no inferred depth or uncalibrated photo sizing |
| ANAT-07 | Save/version conflict/sign/amend/entered-error with exact author/patient/encounter/model history | P; immutable original evidence |
| ANAT-08 | Condition/observation/order/procedure/care-plan/media links and site discrepancy review | P; does not replace independent surgical-site checks |
| ANAT-09 | Historical findings/longitudinal series/trends, read-only old versions, approved overlay or side-by-side comparison | P; C overlays only if geometric compatibility is validated |
| ANAT-10 | Wound/burn/dermatology episodes, tissue fields, serial dimensions, images/calibration and clinician interpretation | C; specialist/model/media governance |
| ANAT-11 | Neuro dermatomes/nerves/motor/sensory and MSK/orthopedic/surgery/renal/cardiac/dental/eye presets | C; versioned specialty assets and clinical review |
| ANAT-12 | Patient education mode, plain-language approved labels/content, hidden internal notes and selected sharing | P; no unreviewed diagnosis or imaging equivalence |
| ANAT-13 | Snapshot/document/print/share evidence, source/date/model, failed-render fallback and photo privacy | P; appropriate export privilege and minimum necessary identity |
| ANAT-14 | Asset download/cache/LOD/memory/performance, renderer/asset/network failure fallback and incomplete history indicator | Q; no silent model replacement |
| ANAT-15 | Model/mapping validation/review/publish/retire/withdraw, license evidence and rollback/history preservation | P governance; approved offline asset packages under EDGE |

## PAT — Patient and proxy experience

Sources: Blueprint §21; IAM-001 §§24–26; PRIV-001 §§19,27–31; CLIN-001 §29; UX-001 §§65–67,91. Band W16 sub-bands; mobile-first separate auth/data boundary. Primary users: patient, independently authenticated proxy/guardian/delegate.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| PAT-01 | Verified enrolment/account linking, patient sign-in/MFA/recovery/session/device security | P; identity assurance appropriate to records/actions |
| PAT-02 | Select own/dependent scope, visible actual proxy identity, authority/expiry/revocation, minor/adulthood review | P; next of kin/contact alone is insufficient authority |
| PAT-03 | Mobile home, care summary/tasks/reminders, accessible plain-language navigation and urgent-care messaging limitations | P; no staff-only/internal sensitive notes |
| PAT-04 | Appointments/details/preparation/check-in/cancel/reschedule/request/self-booking when enabled | P; patient write/availability policies and actual supported contracts |
| PAT-05 | Released visit/discharge summaries, instructions/red flags/care plans and follow-up | P; clinical source/status/provisional meaning preserved |
| PAT-06 | Results/reports/trends with preliminary/final/corrected/source/release explanation and clinician-review restrictions | P; no public unrestricted result release |
| PAT-07 | Medications/prescriptions/change instructions/adherence/history report and reconciliation request | P; patient-entered data not signed clinical fact |
| PAT-08 | Immunizations/product/lot/dose/history/schedule reminders when enabled | P capability; clinical authority and historical uncertainty |
| PAT-09 | Referral status/receiving instructions/travel/preparation, permissible outcome summary | P; internal referral conversation not automatically exposed |
| PAT-10 | Bills/party responsibility/payment/receipts/insurance status and safe pending/failed outcome | P; verified gateway/payment policy |
| PAT-11 | Authorized documents/share/download/expiry and understandable device privacy notice | P; governed release/file access |
| PAT-12 | Nonemergency messages/requests/replies/tasks, contact preferences/quiet hours/channel and delivery states | P; backend messaging and response expectations |
| PAT-13 | Consent/notices/grant/deny/withdraw/representative scope and lawful-basis explanations | P; no coercive optional sharing; clinical consent separate from data sharing |
| PAT-14 | Access/copy/portability/rectification/restriction/objection request submission/status/response | P; governed review/deadline rather than direct record erasure |
| PAT-15 | Patient access transparency/history, demographics update request and approved education/anatomy explanations | C transparency by policy; P request workflow |

## ADM / GOV — Administration, privacy, safety and configuration

Sources: IAM-001 §§5–7,12–16,23–25,31–53,58–62; PRIV-001 §§8–18,24–64,72–79; SAFE-001 §§3–8,22–29,39–41; ONB-001 §§43–55; UX-001 §§63,67–71. Early provisioning in W02; full administration W09 with governance throughout.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| ADM-01 | Organization/group/facility/department/unit/location hierarchy, service points/status/hours/timezone/currency/MRN conventions | P; governed activation/deactivation and history |
| ADM-02 | Workforce identity/HR joiner/mover/leaver, account activation/lock/suspend/disable/expiry/recovery and session revocation | P; historical authorship retained; E HR/payroll authority |
| ADM-03 | Scoped effective memberships/roles/privileges/assignment, role policy versions and denial explanation | P; no self-escalation or universal clinical superuser |
| ADM-04 | Licence/credential evidence/professional scope/facility privileging/restriction/expiry/renewal review | P; professional authority distinct from app role |
| ADM-05 | Supervisor/co-sign/witness/delegation/inbox coverage/temporary on-call and actual-vs-represented actor | P; bounded scope and both identities; no credential sharing |
| ADM-06 | Access requests/approve/reject/expire/periodic certification, stale/orphaned access and SoD conflict review | P; independent approvers and explicit retention |
| ADM-07 | Service identities/API clients/devices/keys rotate/revoke/expiry, integration trust and environment binding | P; secrets protected from ordinary views/exports |
| ADM-08 | Patient proxy/guardian authority/age/sensitive-scope disputes and representative approvals | P; PRIV/IAM policy and independent identity |
| ADM-09 | Config workbook/version/draft/review/approve/publish/effective date/diff/impact/history/rollback | P; no admin removal of core safety controls |
| ADM-10 | Clinical templates/forms/order sets/care pathways/specialty instruments/reference intervals/critical/medication rules | P; named clinical reviewer and verified version |
| ADM-11 | Service/lab/imaging/med/formulary/inventory/UOM/payer/tariff/directory master data and mappings | P; use owning domain configuration; clinical/financial objects remain separate |
| ADM-12 | Queue/workflow/timer/recipient/notification escalation and PHI-safe template/channel/quiet-hour configuration | P; instance retains definition version; critical policy distinct |
| ADM-13 | Feature/capability rollout, facility variants/density/preferences/report definitions and supported-device settings | P; server authority; no facility code forks |
| GOV-01 | Consent/care consent/refusal/data-sharing/research purposes, recipient/resource scope/evidence/version/history/withdrawal | P; lawful basis not manufactured as consent |
| GOV-02 | Disclosure preview/manifest/history/delivery/recipient/release version, bulk-export approval and minimum-necessary review | P; exact disclosure evidence |
| GOV-03 | Restricted/sensitive category/resource policy, discreet indicators, confidential channels and emergency exceptions | P; segmentation also applies to search/export/attachments |
| GOV-04 | Data rights case intake/identity verification/scope/owner/deadline/review/partial fulfil/refuse/secure delivery | P; signed clinical correction is governed separately |
| GOV-05 | Retention rules/category/triggers, legal/clinical holds/release, disposal approvals/evidence and downstream purge status | P governance; E storage/backup purge executor |
| GOV-06 | Audit viewer actor/resource/time/purpose/facility/outcome/correlation, access/export/merge/break-glass/disclosure and controlled audit exports | P; read-only evidence; no log editing |
| GOV-07 | Break-glass and suspicious-access review, exceptional support/JIT access approval/time limit and revocation | P; actual actor visible and restricted support artifacts |
| GOV-08 | Privacy/safety/wrong-recipient/near-miss incident intake, exact affected records, containment/evidence/risk/remediation/CAPA | P or governed external case-system handoff; not a clinical record undo |
| GOV-09 | Processing/data inventory/purpose/owner/recipient/locations/retention/lineage, processor/subprocessor/transfer/agreement register | P governance workspace or managed repository with controlled links |
| GOV-10 | DPIA screening/risks/controls/approval, ethics/data-sharing review and material-change evidence | P governance; E independent legal/clinical decision authority |
| GOV-11 | Hazard/control/requirement/test/evidence/residual-risk/change-impact/safety-case and release sign-off register | P evidence view/workflow or approved external quality system |

## SPC — Specialty and departmental extensions

Sources: Blueprint §§13–15,19–20,33; CLIN-001 §§12–23; BACKLOG-001 §11; LAB-001 Appendix E; backend Sprints 21,23–24,34–38. Bands W19/W20, decomposed below. A separate specialty specification is required for details beyond this functional envelope; do not invent clinical protocols.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| SPC-ED-01 | Emergency/provisional arrival, triage/re-triage/acuity/wait/assignment/location and resuscitation priority | P enabled ED; minimum safe identity, no billing barrier |
| SPC-ED-02 | Time-critical observations/interventions/orders/medications, reassess/escalate and discharge/observe/admit/theatre/ICU/transfer/death | P; accountable effective times and responsibility |
| SPC-ED-03 | Left-before-completion, unknown identity reconciliation and approved mass-casualty abbreviated flows | P exceptions; C mass-casualty configuration |
| SPC-TH-01 | Case requests/list/schedule/suite/team/resources/pre-op/anaesthesia assessment/readiness/consent/cancel/postpone | P enabled theatre; clinical checklist authority |
| SPC-TH-02 | Patient/procedure/site/laterality sign-in/time-out/sign-out, witness attribution and discrepancies | P; no auto-ticked safety checklist |
| SPC-TH-03 | Intra-op procedure/anaesthesia/events/meds/blood/specimens/implants/serial consumables and findings | P; dedicated anaesthesia charts require further specialist contract |
| SPC-TH-04 | Post-op orders/recovery/observations/complications/handover/ward-ICU-discharge | P; actual inventory use separate from planned case cart |
| SPC-BB-01 | Blood-product/unit inventory/quarantine/test/release/expiry and traceability worklist | P enabled transfusion; dedicated transfusion validation |
| SPC-BB-02 | Patient compatibility/group/crossmatch/reservation/issue, expiry and dual-identity verification | P; incompatible/unsupported match cannot proceed normally |
| SPC-BB-03 | Transfusion start/observations/finish/reaction/escalation/return/waste and patient-unit trace | P; attributable clinical event and incident continuity |
| SPC-BB-04 | Donor/recruitment/apheresis and advanced haemovigilance | C; dedicated extension, not part of current transfusion slice |
| SPC-ICU-01 | ICU/HDU patient board/level-of-care/bedflow/monitoring/devices/infusions/observations and escalation/handover | P enabled critical care; validated device integration conditional |
| SPC-REN-01 | Dialysis program/protocol/access/session plan/pre-labs/weights/parameters/start-complete/defer-miss-cancel and longitudinal progress | P enabled renal; each session distinct, protocol version retained |
| SPC-REC-01 | General recurring care EpisodeOfCare/CarePlan/session schedule, pre-treatment checks, outcome/adverse event and plan review | P; program contracts beyond dialysis required |
| SPC-MAT-01 | Antenatal episode/gestational observations/labour-delivery/mother-baby linkage and maternal care | C configured specialty; maternity owner and dedicated acceptance |
| SPC-PED-01 | Pediatric age/weight/growth/guardian/observation and dose-safeguard views | C; validated instruments/dosing and confidentiality policy |
| SPC-ONC-01 | Oncology regimen/cycle/pre-treatment labs/admin/monitor/adverse events and plan amendments | C; approved regimen/protocol and medication safeguards |
| SPC-MH-01 | Mental-health assessment/risk/safety plan and sensitive-care policies | C; approved instruments, privacy segmentation |
| SPC-PT-01 | Physiotherapy functional/body-site assessment/session/outcome trends | C; shared clinical/anatomy/program model |
| SPC-DEN-01 | Dental odontogram/tooth/procedure charting and specialty anatomy | C; licensed semantic assets and dental workflow |
| SPC-EYE-01 | Ophthalmology eye laterality/visual acuity/observations/imaging/procedures | C; specialty contract and owner |
| SPC-IMM-01 | Vaccine administration/product/batch/dose sequence/site/route/schedule/adverse event and imported history | P when enabled; not inferred from dispense |
| SPC-EQP-01 | Equipment asset/serial/model/location/criticality/acquisition-warranty/commission/service/retire and availability | P; equipment authority distinct from clinical device interface |
| SPC-EQP-02 | Preventive maintenance/calibration/work order/parts/due/downtime/service history and scheduling impact | P; maintenance evidence and restricted restore-to-service |
| SPC-WF-01 | Workforce staff/department/shift templates/rosters/on-call/coverage/leave/swap/conflict and assignments | P; HR/roster not sufficient clinical privilege |
| SPC-WF-02 | HOD workload/coverage/supervision/competency and account/assignment lifecycle handoffs | P; no simplistic clinician scoring from activity counts |

## DOC / WRK — Documents, tasks and communication

Sources: ARCH-001 §§17,22–23; FE-001 §§55–60,71–72; UX-001 §§72–74; API-001 §§32–35,66–67; BACKLOG-001 F15. Band W14, with tasks/critical workflows delivered in their earlier owning bands.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| DOC-01 | Patient/encounter/case document list/metadata/source/status/versions, scanned legacy records and restricted attachments | P; document identity/context/retention authority |
| DOC-02 | Upload/capture/type-size validation/progress/checksum/quarantine/malware scan/finalize and failure/retry | P; storage adapter; no early availability before checks |
| DOC-03 | Authorized viewer/download/time-limited link, unavailable/deleted/held status and access evidence | P; no permanent public object URLs |
| DOC-04 | Clinical print layouts/patient ID/version/status/time/confidentiality/page headers and approved barcode/labels | P; print privilege/audit/preview and browser/peripheral acceptance |
| DOC-05 | Async export request/scope/approval/progress/cancel/manifest/expiry/download/revoke | P; server-generated authoritative output and GOV controls |
| DOC-06 | OCR/speech/transcription-assisted drafts and secure clinical photographs | C; review/privacy/licensing; unreviewed extraction never signed fact |
| WRK-01 | Personal/team queues/priority/due/owner/claim/reassign/delegate/escalate/complete/cancel/exception evidence | P; focused underlying resource and durable workflow |
| WRK-02 | Notification centre/unread/archive/deep link/preferences/provider delivery/read/failure/retry | P; critical acknowledgment remains in owning workflow |
| WRK-03 | Patient/case-scoped clinical communication/thread/participants/time/attachments and actionable task linkage | P; no general social-chat assumption |
| WRK-04 | Approval/routing/timer/workflow definition versions and in-flight instance visibility/exception recovery | P governance; no configuration bypass of domain invariants |

## REP / RES / CDS — Insights, research and governed assistance

Sources: Blueprint §§23,32–33; ARCH-001 §24; PRIV-001 §§32–39; ANAT-001 §38; NFR-001 §68; Sprint 38. Band W17 reporting, W20 research, advanced assistance conditional.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| REP-01 | Operational volumes/waits/turnaround/queues/admissions/occupancy/theatre/referral KPIs and source drill-down | P; metric definitions/filters/owner/freshness |
| REP-02 | Clinical outcomes/critical follow-up/readmissions/chronic quality indicators with denominators/source | P configured reports; no fabricated quality interpretation |
| REP-03 | Medication prescribing/dispense/admin/omission/antimicrobial/controlled-drug metrics | P governed scope; supply and admin remain distinct |
| REP-04 | Inventory stockouts/value/expiry/wastage/variance/consumption/supplier and procurement fulfillment | P; physical location and valuation policy |
| REP-05 | Revenue/collections/aging/claims/denials/payer mix/service-line/reconciliation/leakage metrics | P; finance truth and legal entity filters |
| REP-06 | Workforce coverage/workload, referral network acceptance/decline/transfer/outcome and group dashboards | P; permission-aware drill-down and context |
| REP-07 | Executive/HOD command centre, accessible charts/tables/date-window/comparisons/saved reports/approved export | P; low-cell disclosure controls, data freshness |
| REP-08 | Regulatory extracts/national reporting/dataset definitions/mapping/validation/submission evidence | C; approved local standards and adapter; no presumed national API |
| RES-01 | Study/protocol/ethics approvals/owner/purpose/consent/documents and study lifecycle | P governance; scientific/ethics authority external |
| RES-02 | Versioned cohort definitions/criteria preview/approval, query execution/progress/exception and permitted dataset | P definition/governance; C warehouse execution |
| RES-03 | Dataset request/approve/deny/minimum fields/de-identification/pseudonyms/manifest/generate/download/expiry/revoke | P; export scope/security and source provenance |
| RES-04 | Protected subject-link vault, authorized re-identification request/release and access audit | P governed controls; no routine researcher identifiers |
| CDS-01 | Approved rule/pathway guidance, severity/current inputs/source/version/time, response/override and review | P validated rule presentation; no silent clinical action |
| CDS-02 | AI-assisted summary/draft/anatomy/imaging suggestions with clear labeling, clinician acceptance and original source | C; separate safety/privacy/data-use evaluation |
| CDS-03 | Rule/model change approvals/validation/activation/rollback, performance/bias/drift/alert-fatigue and effectiveness review | C when assistance enabled; E model training/runtime tools |

## INT / EDGE — Integration and resilient operation

Sources: FHIR-001 §§6,43–78; API-001 §§36,69–72; EVT-001 §§25–27,67–76; ARCH-001 §§11–13; OPS-001 §§23–27,84; SEC-001 §§35–40; BACKLOG-001 F18/F21. Bands W09 integration oversight, W21 approved offline and departmental adapter sub-bands.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| INT-01 | Partner/service/endpoint/capability/profile/version/contact/environment/scopes/certification and credential expiry register | P admin; E FHIR/HL7/DICOM exchange runtime |
| INT-02 | Interface health/backlog/lag/retry/DLQ/outbox/delivery/SLO/dependency status and clinical-impact links | P scoped operations; PHI-minimized diagnostics |
| INT-03 | Incoming staging/unknown patient/demographic/code/unit/duplicate/unmatched study/quarantine exception queues | P; domain-authorized reconciliation, preserve source |
| INT-04 | Versioned terminology/value sets/code mappings/exact-broader-narrower-unmatched review and license/effective status | P; unknown/lossy mappings visible; no silent historic remap |
| INT-05 | Import/batch/bulk validation/preview/per-item outcomes/async progress/identity/source authority and provenance | P governance; E adapters/import workers |
| INT-06 | Controlled replay/dry-run/filter/reason/approval/monitor/idempotency and incident correction evidence | P operations; no arbitrary payload editing to force success |
| INT-07 | LIS/PACS/payer/payment/notification/object-storage/vendor unavailable state, fallback and reconciliation | Q on relevant screens; E authoritative vendor tools |
| INT-08 | National/HIE/registry/payer onboarding/profile readiness, conformance and governed exchange status | C; current approved profiles/contracts required |
| EDGE-01 | Device/node enrolment/suspend/decommission/capability/policy/version/last seen and facility binding | P admin; E deployed edge agent/runtime |
| EDGE-02 | Persistently visible online/degraded/offline/last sync/backlog and locally incomplete data | Q; cached approval/identity policy with expiry |
| EDGE-03 | Approved offline clinical subset/queued local commands/event IDs/durable draft or signed fact and restart survival | C activation; encrypted storage/edge authority and allowed commands |
| EDGE-04 | Reconnect/upload/download/ack/rejected/duplicate/missing dependency/per-resource progress | P if offline enabled; queued not completed centrally |
| EDGE-05 | Clinical/financial/inventory conflicts preserving both facts, authorized reconciliation/version outcome | P if offline enabled; no blind last-write-wins |
| EDGE-06 | Device loss/revocation uncertainty/stale privilege safe restrictions, peripheral failure and downtime fallback | Q; no unrestricted access on IAM outage |
| EDGE-07 | Approved anatomy/terminology/local record asset packages/cache/expiry and incomplete historical view | C offline capability; license and integrity manifest |

## OPS / MIG / ONB — Service operations, onboarding and transition

Sources: OPS-001 §§30–97; MIG-001 §§6–96; ONB-001 §§8–98; SEC-001 §§53–70; runbooks and Sprints 31–33. Band W22 plus W09 admin/system-health links. Operators may use connected operational tools; product scope is status, workflow, controlled handoff and evidence—not a requirement to replace every specialist tool.

| ID | Functionality and frontend behavior | Disposition / prerequisite |
|---|---|---|
| OPS-01 | Service/facility/dependency health/SLO/latency/availability/queue freshness/capacity and runbook links | P authorized admin; E metrics/logs/traces backend |
| OPS-02 | Alerts ack/owner/escalate/on-call/routing/resolve/history, provider failure and accountable incident | P or controlled external alerting handoff |
| OPS-03 | Incident/support intake/classification/severity/affected facility/workflow/reference, safe evidence and status/communications | P or approved service desk; secrets and PHI minimized |
| OPS-04 | Maintenance/release/change window/impact/approvals/rollback/known issues and user notices | P visibility; E CI/CD/orchestrator mutation |
| OPS-05 | Backup/status/staleness/recovery-point/restore drill/integrity/RPO-RTO evidence and DR exercises | P evidence; E privileged backup/restore/failover execution |
| OPS-06 | Downtime activation/affected capability/workaround/registered artifacts/recovery tasks and reconciliation sign-off | P clinical/operational workflow; no false synchronized state |
| OPS-07 | Security findings/triage/exceptions/patch/SBOM/dependency evidence, suspicious-access and clinical-integrity incident checks | P evidence or external security platform; scope-limited roles |
| OPS-08 | Certificate/domain/secret/device/vendor expiry/contact inventory, support tiers and known-error/CAPA review | P status and governed requests; E secret/runtime operations |
| MIG-01 | Source inventory/profile/authority/data-quality/mapping/version/reviewer/source-to-target evidence | P controlled migration workbench or existing tooling artifact viewer |
| MIG-02 | Identity duplicate/unmapped code/unit/date/null/provenance/conflicting source and orphan exception queue | P human review; no silent discard/semantic invention |
| MIG-03 | Dry-run/dress rehearsal/job progress/volume/performance and idempotent validation summaries | P evidence; E ETL/DB runners |
| MIG-04 | Count/value/state/relation/hash reconciliation and chart/active-meds/open-orders/stock/finance clinical sample review | P; domain sign-off and blocking M0/M1 issues |
| MIG-05 | Freeze/delta/dual-run authority/cutover timeline/go-no-go/rollback feasibility and command evidence | P controlled readiness; E physical migration execution |
| MIG-06 | Post-go-live exceptions/delta reconciliation/legacy read-only/archive/link/retirement | P; history/provenance preserved and no direct DB repair UI |
| ONB-01 | Facility discovery/journey mapping/delta/gap/RACI/config workbook and integration/peripheral/network readiness | P implementation hub or governed workbook; named owners |
| ONB-02 | Configuration/clinical/privacy/safety review, realistic role UAT/simulations and defect/evidence status | P controlled acceptance workspace |
| ONB-03 | Role training/materials/synthetic sandbox/super-user support/competency/remediation/refresher records | P training workflow; no automatic privilege from super-user label |
| ONB-04 | Readiness green/amber/red/owners/evidence, go-live gate/command-centre/floor support and hypercare issue triage | P; blocking safety/security/integrity issues cannot be scheduled away |
| ONB-05 | Adoption/safety workflow completion/unsigned notes/review/omissions/near-miss/downtime metrics and stabilization handover | P; accountable acceptance, not login counts alone |
| ONB-06 | Multi-facility rollout/standard template/local differences/training/integration validation and 30/60/90-day review | P; no copied unsafe local exception or product fork |

## Q — Cross-cutting acceptance scope

Sources: full FE/UX/NFR/QA/SAFE/SEC/PRIV/API/DB/ENG/BE/EVT requirements. Applied at every band, not postponed to a final audit.

| ID | Required behavior / verification |
|---|---|
| Q-01 | Screen/workflow ID, role/owner, route/deep link, patient/encounter/facility/purpose, requirements/hazards and acceptance traceability |
| Q-02 | Default/loading/empty/filtered-empty/denied/read-only/unavailable/stale/offline/queued/conflict/pending/unknown/confirmed/amended states |
| Q-03 | WCAG AA-aligned contrast, keyboard/focus/reader/live announcements, zoom/reflow/reduced motion and meaningful text/icon status |
| Q-04 | Desktop data density, ward tablet/touch and focused phone workflows; critical identity/alert/action never hidden by responsive layout |
| Q-05 | Typed governed contracts, field errors/correlation IDs, bounded page/filter/sort/search, cancel stale request, query invalidation and no unsafe shared cache |
| Q-06 | Server capability/privilege/consent/object scope; cross-tenant/facility/patient/deep-link negatives, inactive account/credential and session tamper/expiry |
| Q-07 | Version/expected-state/idempotency, duplicate/retry/unknown outcome, outbox/audit/provenance durability and independently attributable signatures |
| Q-08 | XSS/CSRF/origin/cache/CSP/download/upload controls, PHI-minimal storage/URL/telemetry/support capture and no browser token disclosure |
| Q-09 | Explicit clinical vs financial, order vs encounter, dispense vs admin, release/read/delivery vs acknowledgment and accept/arrive/care-assume semantics |
| Q-10 | Decimal/currency/unit/date-only/instant/timezone/source/clinical effective time; unknown not zero/negative, precise source provenance and missing data |
| Q-11 | UI/component/contract/API/browser/negative/visual/a11y tests, realistic density/network/peripheral/print and measured relevant NFR budgets |
| Q-12 | Clinical usability/safety/privacy/security review, verified adapters/configuration, approved residual risk, downtime/recovery/training/support and release evidence |

## Explicit exclusions and conditional scope

The product does not provide autonomous diagnosis/treatment, unreviewed AI signing, routine all-facility chart browsing, similarity-based automatic patient merge, hidden last-write-wins for signed clinical facts, financial status rewriting care, or unrestricted administrator clinical access. Nationwide identity/biometrics, advanced AI, external national profiles, specialist assets and validated hardware integrations are conditional governed extensions, not implicit first-release commitments.

PACS pixels/diagnostic viewer validation, analyzer processing, cloud infrastructure control, ETL execution, professional/legal decisions, payroll/general ledger/accounts payable and complex statutory tendering remain owned boundaries. Their required handoff/status/reconciliation/evidence is included above. Capitation/bundled pricing is retained as a future documented extension and remains excluded from CR-001 Phase 1/2 scope unless separately changed.

## Planning and completeness limits

The scope register makes documented functionality visible and assigns a proposed delivery home; it does not assert every contract exists. Before a capability becomes Ready, expand its workflow into actor/entry/context/data/action/permission/state/validation/error/offline/audit/accessibility/performance/hazard/acceptance details using UX-001 §83. Add exact API read/command contracts and the owning domain's clinical or operational state machine.

Open baseline gaps: standalone DATA-001 is absent; dedicated specialty/backend-follow-on specifications must define details not yet covered; final pilot scope, named clinical/QA owners and approved vendor/hardware/legal policies remain decisions. These are explicit prerequisites and do not erase the functionality from this catalogue.
