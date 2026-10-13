# Pulse — Backlog Tracker (updatable)

Live tracker. Source specs: `PULSE-BACKLOG-001 §7–§8` (features F01.1–F15.4 + R4–R6), `§9–§11`.
Update `Status` + `Sprint` + `Evidence` as you go. Keep `Spec ref` stable.

Status values: `Not started | Ready | In progress | In review | Done | Blocked`

## R0–R1 — Foundation + Core Record

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-01 | Platform Foundation | R0 | ENG-001, BE-001, OPS-001 | Done | SPRINT_01 | — | all F01.1–F01.5 Done; turbo build 9/9, boundaries/secrets gates live |
| F01.1 | Repository & workspace foundation (pnpm/turbo, apps/packages/infra/scripts) | R0 | ENG-001 §6 | Done | SPRINT_01 | — | packages/* + docs/ADRs 001–006, CODEOWNERS, check-boundaries (neg test exit 1) |
| F01.2 | Local dev infra (Postgres/Redis/MinIO compose, seed, migration runner) | R0 | DB-001 §3, OPS-001 §5 | Done | SPRINT_01 | — | compose + 0001_platform_outbox_inbox_audit.sql, Kysely decision ADR-006, relay/runner → Sp02 |
| F01.3 | CI quality pipeline (build/lint/typecheck/test/boundary-lint/container) | R0 | ENG-001 §73–§74 | Done | SPRINT_01 | — | build 8/8, lint 0/0, unit 1/1, e2e 5/5, boundaries wired (turbo + pnpm) |
| F01.4 | Backend platform primitives (config, validation, exceptions, ctx, health, outbox) | R0 | BE-001 §28–§44, EVT-001 §7 | Done | SPRINT_01 | — | config, ProblemDetails, correlation mw, /health/live+ready, /api/v1, DatabaseModule (Kysely lazy) |
| F01.5 | Frontend shell & design tokens (Inter/Jakarta, teal/sage palette, sidebar, facility ctx) | R0 | UX-001, FE-001, brand/ | Done | SPRINT_01 | — | @pulse/ui tokens + web-clinical shell builds, sidebar/facility/banner stubs |
| EPIC-02 | Organization, Tenant & Facility | R1 | ARCH-001 §25, CLIN-001 | Done | SPRINT_02 | — | F02.1 registry (Sp03), F02.3 context guard (Sp02), F02.2 hierarchy (Sp27); proven live PG16 |
| F02.1 | Organization/facility registry | R1 | CLIN-001, DB-001 §9–§10 | Done | SPRINT_03 | — | module+controller+repo; proven vs live PG16 (migrate + int 2/2) |
| F02.2 | Department/location hierarchy | R1 | ARCH-001 §6 | Done | SPRINT_27 | — | parent-department self-FK + `org.unit` + `org.location` (kind enum); proven live PG (migrate 0001–0023, int 45/45) |
| F02.3 | Facility context selection + scoping guard | R1 | ENG-001 §86, BE-001 §73–§74 | Done | SPRINT_02 | — | TenantContextGuard (UUID) + ALS + secure/ping e2e |
| EPIC-03 | Identity, Auth & Clinical Privileges | R1 | IAM-001, SEC-001 | Done | SPRINT_02 | — | F03.1–F03.5 all Done (Sp25 staff auth, Sp26 contextual authz + break-glass); proven live PG |
| F03.1 | Staff authentication/session (password + MFA-ready + SSO/SmartCard seam) | R1 | IAM-001 §8 | Done | SPRINT_25 | — | scrypt creds + opaque `staff_` sessions + RFC-6238 TOTP MFA; demo headers now gated behind `ALLOW_DEMO_AUTH`; proven live PG (migrate 0001–0021, int 3/3, e2e 49/49) |
| F03.2 | Membership/role assignment (scoped) | R1 | IAM-001 §5–§7 | Done | SPRINT_02 | — | Kysely repo + service; guard prefers DB, demo fallback; proven vs live PG |
| F03.3 | Clinical privilege model (role ≠ privilege) | R1 | IAM-001 §3 | Done | SPRINT_02 | — | evaluateAccess default-deny, 3 unit tests |
| F03.4 | Contextual authorization engine (facility/dept/care-relationship/consent) | R1 | IAM-001 §2, BE-001 §33 | Done | SPRINT_26 | — | policy v2: facility → department → purpose → privilege → care-relationship narrowing (`x-patient-id` + `iam.care_assignment`); proven live PG (migrate 0001–0022, int 42/42, e2e 54/54) |
| F03.5 | Break-glass (time-limited, reason, audited) | R1 | IAM-001, ENG-001 §28 | Done | SPRINT_26 | — | clinical-only eligibility, reason quality + 3/24h abuse deny, 30-min grants in `iam.break_glass_grant`, outbox Activated/Expired; proven live PG |
| EPIC-04 | Patient Identity & Registration | R1 | CLIN-001 §4, DB-001 §11–§13 | Done | SPRINT_04 | — | register/search/dup-review/merge/summary; proven vs live PG |
| F04.1 | Patient registration (canonical + MRN + identifiers) | R1 | DB-001 §11–§12 | Done | SPRINT_04 | — | CONFIRMED-block + REVIEW passthrough; MRN namespaced per facility |
| F04.2 | Patient search (measured indexes, min-necessary display) | R1 | DB-001 §66 | Done | SPRINT_04 | — | id-exact + name-prefix, facility-scoped, min fields |
| F04.3 | Duplicate candidate review | R1 | CLIN-001 §4 | Done | SPRINT_04 | — | pure scoring, CONFIRMED/REVIEW, never auto-merges |
| F04.4 | Patient merge (governed, history preserved) | R1 | DB-001 §13 | Done | SPRINT_04 | — | merge_link + retired-duplicate, both rows kept |
| F04.5 | Patient context banner (persistent, explicit) | R1 | UX-001 §6, FE-001 §42 | Done | SPRINT_04 | — | GET /patients/:id/summary (banner data) + shell empty state |
| EPIC-05 | Scheduling, Appointment & Queue | R1 | CLIN-001 §5 | Done | SPRINT_06 | — | book/check-in/start/complete/cancel/no-show/reschedule + queue; proven live |
| F05.1 | Appointment booking | R1 | CLIN-001 §5 | Done | SPRINT_06 | — | + outbox booked |
| F05.2 | Check-in | R1 | CLIN-001 §5 | Done | SPRINT_06 | — | guarded transition |
| F05.3 | Queue worklist | R1 | CLIN-001 §5 | Done | SPRINT_06 | — | facility-scoped, active only |
| F05.4 | Cancel/reschedule/no-show (reason retained) | R1 | CLIN-001 §5 | Done | SPRINT_06 | — | terminal + reschedule rules |
| EPIC-06 | Encounter, ADT, Ward & Bed Core | R1 | CLIN-001, DB-001 §14–§15 | Done | SPRINT_05 | — | open/admit/transfer/discharge/cancel + history; proven vs live PG |
| F06.1 | Open encounter | R1 | DB-001 §14 | Done | SPRINT_05 | — | active-patient + facility-match guards |
| F06.2 | Admission | R1 | CLIN-001 | Done | SPRINT_05 | — | dept/bed, history row |
| F06.3 | Transfer | R1 | CLIN-001 | Done | SPRINT_05 | — | admitted-only, history row |
| F06.4 | Discharge | R1 | CLIN-001 | Done | SPRINT_05 | — | disposition, outpatient/emergency direct allowed |
| EPIC-07 | Triage, Vitals & Nursing Core | R1 | CLIN-001 §6 | Done | SPRINT_06 | — | typed observations; handover tasks → Sp07 |
| F07.1 | Triage assessment | R1 | CLIN-001 | Done | SPRINT_06 | — | via observation codes |
| F07.2 | Vitals capture (typed observations) | R1 | DB-001 §19–§20 | Done | SPRINT_06 | — | num/text + unit, CHECK enforced |
| F07.3 | Nursing task/handover baseline | R1 | CLIN-001 | Done | SPRINT_15 | — | handover composition via ports |
| EPIC-08 | Clinical Documentation & Problem Record | R1 | CLIN-001, DB-001 §16–§18 | Done | SPRINT_06 | — | draft/sign/addendum/entries/timeline; proven live |
| F08.1 | Clinical note draft | R1 | DB-001 §16 | Done | SPRINT_06 | — | + outbox drafted |
| F08.2 | Sign clinical note (immutable) | R1 | ENG-001 §29 | Done | SPRINT_06 | — | once-only, 409 after |
| F08.3 | Addendum/correction (no silent overwrite) | R1 | ARCH-001 §2 | Done | SPRINT_06 | — | append-only table |
| F08.4 | Allergy/problem record | R1 | DB-001 §17–§18 | Done | SPRINT_06 | — | kind-checked entries |
| F08.5 | Patient timeline | R1 | DB-001 §85 | Done | SPRINT_06 | — | 5-kind merged timeline |

## R2 — Diagnostics & Medication

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-09 | Orders & Terminology Foundation | R2 | CLIN-001, DB-001 §59 | Done | SPRINT_07 | — | lab order machine + @pulse/terminology (versioned, no silent remap) |
| F09.1 | Terminology service client (versioned, no silent remap) | R2 | ENG-001 §51, ANAT-001 §8 | Done | SPRINT_07 | — | TerminologyClient exact+pinned; FHIR-backed → R4 |
| F09.2 | Create service order | R2 | CLIN-001 | Done | SPRINT_07 | — | via lab.placeOrder (catalogue-pinned) |
| F09.3 | Order cancellation (reason + state guard) | R2 | CLIN-001 | Done | SPRINT_07 | — | reason required, verified-terminal barred |
| EPIC-10 | Laboratory | R2 | LAB-001, DB-001 §21–§24 | Done | SPRINT_07 | — | order→verify + critical-ack; proven live |
| F10.1 | Lab order intake | R2 | LAB-001 §9–§10 | Done | SPRINT_07 | — | urgency/indication, worklist |
| F10.2 | Specimen collection/accession | R2 | LAB-001 §11, DB-001 §22 | Done | SPRINT_07 | — | container+label enforced |
| F10.3 | Result entry/import | R2 | LAB-001, DB-001 §23 | Done | SPRINT_07 | — | versioned, amend=new version |
| F10.4 | Verify/finalize report | R2 | LAB-001, DB-001 §24 | Done | SPRINT_07 | — | once-only verify |
| F10.5 | Critical result acknowledgement (accountable workflow) | R2 | LAB-001, SAFE-001 | Done | SPRINT_07 | — | ack-by/at + critical event |
| EPIC-11 | Imaging / RIS-PACS Workflow | R2 | IMG-001, DB-001 §25 | Done | SPRINT_08 | — | order→final, PACS refs only, amend versions; proven live |
| F11.1 | Imaging order/schedule | R2 | IMG-001 §7–§10 | Done | SPRINT_08 | — | laterality rule enforced |
| F11.2 | Study linkage (DICOM ref, pixels stay in PACS) | R2 | IMG-001 §1, ARCH-001 §18 | Done | SPRINT_08 | — | StudyUID unique |
| F11.3 | Viewer launch (authorized) | R2 | IMG-001, IAM-001 | Done | SPRINT_08 | — | authorized stub; signed-URL → PACS adapter |
| F11.4 | Radiology report (final/amended) | R2 | IMG-001 | Done | SPRINT_08 | — | versioned, finalize once |
| EPIC-12 | Medication, Pharmacy & eMAR | R2 | MED-001, DB-001 §26–§30 | Done | SPRINT_08 | — | prescribe→administer + held path; proven live |
| F12.1 | Medication prescribing (dose/route/frequency structured) | R2 | MED-001 §10, DB-001 §27 | Done | SPRINT_08 | — | structured-required 400 |
| F12.2 | Pharmacist verification | R2 | MED-001, DB-001 §28 | Done | SPRINT_08 | — | verify-before-dispense |
| F12.3 | Dispense (batch traceable) | R2 | MED-001, DB-001 §29, INV-001 | Done | SPRINT_08 | — | batch captured for R3 |
| F12.4 | eMAR schedule | R2 | MED-001, DB-001 §30 | Done | SPRINT_08 | — | administrations feed schedule |
| F12.5 | Record administration | R2 | MED-001, DB-001 §30 | Done | SPRINT_08 | — | dispense-required |
| F12.6 | Not given/held/correction | R2 | MED-001 | Done | SPRINT_08 | — | reason-required, every dose accounted |
| ANAT | Anatomical Mapping Engine (ACME) | R2+ | ANAT-001 | In progress | SPRINT_28 | — | backend core (Sp28): model/structure catalogue + finding draft→sign→amend→enter-error + links + laterality safety; proven live PG (migrate 0001–0024, int 47/47); renderer/UI, presets, snapshots/media, FHIR export later |

## R3 — Operations & Revenue

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-13 | Inventory, Stores & Procurement | R3 | INV-001, DB-001 §31–§34 | Done | SPRINT_09 | — | ledger/batches/FEFO/procurement; proven live |
| F13.1 | Catalog/locations (UOM normalized) | R3 | INV-001 §5–§7 | Done | SPRINT_09 | — | idempotent define, hierarchy |
| F13.2 | Receive stock (batch/lot + expiry) | R3 | INV-001 §11–§13 | Done | SPRINT_09 | — | lot ensured, ledger + |
| F13.3 | Issue/consume stock (immutable ledger) | R3 | INV-001 §8–§9 | Done | SPRINT_09 | — | balance-guarded 422 |
| F13.4 | Stock count/reconciliation | R3 | INV-001 | Done | SPRINT_09 | — | signed adjust + reason |
| F13.5 | Procurement cycle (req → PO → receipt) | R3 | INV-001, DB-001 §34 | Done | SPRINT_09 | — | receipt posts ledger |
| EPIC-14 | Billing, Payments, Insurance & Claims | R3 | REV-001, DB-001 §37–§40 | Done | SPRINT_10 | — | money chain + claim loop; proven live |
| F14.1 | Charge capture (projection, never rewrites clinical) | R3 | REV-001 §4 | Done | SPRINT_10 | — | tariff-pinned at capture |
| F14.2 | Invoice | R3 | REV-001, DB-001 §38 | Done | SPRINT_10 | — | charge-derived lines, paid/partial auto |
| F14.3 | Payment / refund / adjustment | R3 | REV-001, DB-001 §39 | Done | SPRINT_10 | — | allocation + reasoned adjustments |
| F14.4 | Insurance eligibility/authorization | R3 | REV-001 §10–§11 | Done | SPRINT_10 | — | time-bound check + auth record |
| F14.5 | Claim lifecycle | R3 | REV-001, DB-001 §40 | Done | SPRINT_10 | — | deny/appeal loop with reasons |
| EPIC-15 | Workflow, Tasks, Notifications & Documents | R3 | ARCH-001 §22–§23, DB-001 §44–§45 | Done | SPRINT_09 | — | tasks/notify/docs metadata; proven live |
| F15.1 | Durable task (state machine, escalation) | R3 | ARCH-001 §22 | Done | SPRINT_09 | — | open→done/escalated/cancelled |
| F15.2 | Notification delivery (async, minimum PHI) | R3 | ARCH-001 §23, EVT-001 | Done | SPRINT_09 | — | recorded + outbox; adapters later |
| F15.3 | Document upload (object storage + metadata) | R3 | ARCH-001 §17, DB-001 §44 | Done | SPRINT_09 | — | pointer-only, traversal refused |
| F15.4 | Print/export (governed) | R3 | ENG-001 §88 | Done | SPRINT_15 | — | JSON bundle, audited + outbox |
| EPIC-20 | Reporting & Analytics (baseline) | R3/R5 | ARCH-001 §24 | Done | SPRINT_15 | — | census/revenue/claims reports; feeds later |

## R4–R6 — Network, Resilience, Specialties

| ID | Epic | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|------|---------|----------|--------|--------|-------|----------|
| EPIC-16 | Consent, Privacy & Disclosure | R4 | PRIV-001, IAM-001, DB-001 §41 | Done | SPRINT_11 | — | capture/withdraw/gate + disclosure log; proven live |
| EPIC-17 | Inter-Hospital Referral & Transfer (RTX) | R4 | REF-001, DB-001 §35–§36 | Done | SPRINT_11 | — | consent-gated RTX machine + messaging; proven live |
| EPIC-18 | FHIR / External Integration Gateway | R4 | FHIR-001, API-001 | Done | SPRINT_29 | — | read gateway + partner keys (SPRINT_12) + writes: Condition/Allergy/Observation create, idempotency, provenance, HL7v2 ORU adapter (SPRINT_29); proven live |
| EPIC-19 | Patient Portal & Proxy Access | R4 | UX-001, PRIV-001 | Done | SPRINT_16 | — | scrypt auth, sessions, proxy act-as, scoped reads; proven live |
| EPIC-21 | Facility Edge & Offline Resilience | R5 | ARCH-001 §13, OPS-001 | Done | SPRINT_30 | — | feed/apply/conflicts (SPRINT_19) + device runtime, capability subset, heartbeat/degraded (SPRINT_30) |
| EPIC-22 | Security, Privacy & Compliance (continuous) | All | SEC-001, PRIV-001 | Done | SPRINT_31 | — | secrets/authz/break-glass/audit (earlier sprints) + SIEM feed, detections D1/D2, SCA gate, pentest/SCA findings triage (SPRINT_31); dep-upgrade train tracked as follow-on |
| EPIC-23 | Observability, SRE, Backup & DR (continuous) | R0–R5 | OPS-001, NFR-001 | Done | SPRINT_32 | — | metrics/SLOs/runbooks (SPRINT_17) + alert rules/evaluation, backup evidence register, live restore drill w/ RTO measurement (SPRINT_32); follow-on: periodic eval, ack workflow, WAL/PITR, full-stack DR exercise |
| EPIC-24 | Migration, Onboarding & Go-Live | R5 | MIG-001, ONB-001 | Done | SPRINT_33 | — | twice-safe demo seed + onboarding runbook (SPRINT_18) + clinical seed, timed cutover dress rehearsal w/ freeze+reconcile+rollback drill (SPRINT_33); pilot runs it at T-7 + manual Appendix C sign-offs |
| EPIC-25 | Specialty Expansion (ED, theatre, ICU, dialysis, blood bank, equipment, roster) | R6 | CLIN-001, LAB-001 §3 | Done | SPRINT_38 | — | ED (S21), theatre (S23), blood bank (S24), dialysis (S34), equipment (S35), roster (S36), ICU/HDU bed-flow + level of care (S37), research governance (S38) — epic closed |

## Vertical-slice exit checklist (BACKLOG-001 §13)

- [ ] Fresh env from source-controlled infra/config
- [ ] All schema via migrations
- [ ] Machine-readable API contract + tests
- [ ] UI maintains patient/facility/encounter context visibly
- [ ] Signed note cannot be overwritten
- [ ] Lab order durable + event emitted transactionally
- [ ] Cross-tenant/facility actions denied
- [ ] Audit records for sensitive actions
- [ ] Logs have correlation, no narrative/secret
- [ ] Backup/restore smoke passes
- [ ] CI green from clean checkout
- [ ] Clinician walkthrough signed off

## How to update

1. Planning: set `Status=Ready`, assign `Sprint=SPRINT_XX`, `Owner`.
2. Daily: `In progress` → `In review` when PR opened; link PR in `Evidence`.
3. Review: `Done` only with DoD + gate evidence linked. Otherwise carry over.
4. Add rows only for decomposed stories as `EPIC-XX.F##.S##` beneath parent epic — never delete parent rows.
