# Pulse — Backlog Tracker (updatable)

Live tracker. Source specs: `PULSE-BACKLOG-001 §7–§8` (features F01.1–F15.4 + R4–R6), `§9–§11`.
Update `Status` + `Sprint` + `Evidence` as you go. Keep `Spec ref` stable.

Status values: `Not started | Ready | In progress | In review | Done | Blocked`

## R0–R1 — Foundation + Core Record

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-01 | Platform Foundation | R0 | ENG-001, BE-001, OPS-001 | In progress | SPRINT_01 | — | turbo build 8/8, e2e 5/5, boundaries ok |
| F01.1 | Repository & workspace foundation (pnpm/turbo, apps/packages/infra/scripts) | R0 | ENG-001 §6 | Done | SPRINT_01 | — | packages/* + docs/ADRs 001–006, CODEOWNERS, check-boundaries (neg test exit 1) |
| F01.2 | Local dev infra (Postgres/Redis/MinIO compose, seed, migration runner) | R0 | DB-001 §3, OPS-001 §5 | Done | SPRINT_01 | — | compose + 0001_platform_outbox_inbox_audit.sql, Kysely decision ADR-006, relay/runner → Sp02 |
| F01.3 | CI quality pipeline (build/lint/typecheck/test/boundary-lint/container) | R0 | ENG-001 §73–§74 | Done | SPRINT_01 | — | build 8/8, lint 0/0, unit 1/1, e2e 5/5, boundaries wired (turbo + pnpm) |
| F01.4 | Backend platform primitives (config, validation, exceptions, ctx, health, outbox) | R0 | BE-001 §28–§44, EVT-001 §7 | Done | SPRINT_01 | — | config, ProblemDetails, correlation mw, /health/live+ready, /api/v1, DatabaseModule (Kysely lazy) |
| F01.5 | Frontend shell & design tokens (Inter/Jakarta, teal/sage palette, sidebar, facility ctx) | R0 | UX-001, FE-001, brand/ | Done | SPRINT_01 | — | @pulse/ui tokens + web-clinical shell builds, sidebar/facility/banner stubs |
| EPIC-02 | Organization, Tenant & Facility | R1 | ARCH-001 §25, CLIN-001 | Not started | — | — | — |
| F02.1 | Organization/facility registry | R1 | CLIN-001, DB-001 §9–§10 | Not started | — | — | — |
| F02.2 | Department/location hierarchy | R1 | ARCH-001 §6 | Not started | — | — | — |
| F02.3 | Facility context selection + scoping guard | R1 | ENG-001 §86, BE-001 §73–§74 | Not started | — | — | — |
| EPIC-03 | Identity, Auth & Clinical Privileges | R1 | IAM-001, SEC-001 | Not started | — | — | — |
| F03.1 | Staff authentication/session (password + MFA-ready + SSO/SmartCard seam) | R1 | IAM-001 §8 | Not started | — | — | — |
| F03.2 | Membership/role assignment (scoped) | R1 | IAM-001 §5–§7 | Not started | — | — | — |
| F03.3 | Clinical privilege model (role ≠ privilege) | R1 | IAM-001 §3 | Not started | — | — | — |
| F03.4 | Contextual authorization engine (facility/dept/care-relationship/consent) | R1 | IAM-001 §2, BE-001 §33 | Not started | — | — | — |
| F03.5 | Break-glass (time-limited, reason, audited) | R1 | IAM-001, ENG-001 §28 | Not started | — | — | — |
| EPIC-04 | Patient Identity & Registration | R1 | CLIN-001 §4, DB-001 §11–§13 | Not started | — | — | — |
| F04.1 | Patient registration (canonical + MRN + identifiers) | R1 | DB-001 §11–§12 | Not started | — | — | — |
| F04.2 | Patient search (measured indexes, min-necessary display) | R1 | DB-001 §66 | Not started | — | — | — |
| F04.3 | Duplicate candidate review | R1 | CLIN-001 §4 | Not started | — | — | — |
| F04.4 | Patient merge (governed, history preserved) | R1 | DB-001 §13 | Not started | — | — | — |
| F04.5 | Patient context banner (persistent, explicit) | R1 | UX-001 §6, FE-001 §42 | Not started | — | — | — |
| EPIC-05 | Scheduling, Appointment & Queue | R1 | CLIN-001 §5 | Not started | — | — | — |
| F05.1 | Appointment booking | R1 | CLIN-001 §5 | Not started | — | — | — |
| F05.2 | Check-in | R1 | CLIN-001 §5 | Not started | — | — | — |
| F05.3 | Queue worklist | R1 | CLIN-001 §5 | Not started | — | — | — |
| F05.4 | Cancel/reschedule/no-show (reason retained) | R1 | CLIN-001 §5 | Not started | — | — | — |
| EPIC-06 | Encounter, ADT, Ward & Bed Core | R1 | CLIN-001, DB-001 §14–§15 | Not started | — | — | — |
| F06.1 | Open encounter | R1 | DB-001 §14 | Not started | — | — | — |
| F06.2 | Admission | R1 | CLIN-001 | Not started | — | — | — |
| F06.3 | Transfer | R1 | CLIN-001 | Not started | — | — | — |
| F06.4 | Discharge | R1 | CLIN-001 | Not started | — | — | — |
| EPIC-07 | Triage, Vitals & Nursing Core | R1 | CLIN-001 §6 | Not started | — | — | — |
| F07.1 | Triage assessment | R1 | CLIN-001 | Not started | — | — | — |
| F07.2 | Vitals capture (typed observations) | R1 | DB-001 §19–§20 | Not started | — | — | — |
| F07.3 | Nursing task/handover baseline | R1 | CLIN-001 | Not started | — | — | — |
| EPIC-08 | Clinical Documentation & Problem Record | R1 | CLIN-001, DB-001 §16–§18 | Not started | — | — | — |
| F08.1 | Clinical note draft | R1 | DB-001 §16 | Not started | — | — | — |
| F08.2 | Sign clinical note (immutable) | R1 | ENG-001 §29 | Not started | — | — | — |
| F08.3 | Addendum/correction (no silent overwrite) | R1 | ARCH-001 §2 | Not started | — | — | — |
| F08.4 | Allergy/problem record | R1 | DB-001 §17–§18 | Not started | — | — | — |
| F08.5 | Patient timeline | R1 | DB-001 §85 | Not started | — | — | — |

## R2 — Diagnostics & Medication

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-09 | Orders & Terminology Foundation | R2 | CLIN-001, DB-001 §59 | Not started | — | — | — |
| F09.1 | Terminology service client (versioned, no silent remap) | R2 | ENG-001 §51, ANAT-001 §8 | Not started | — | — | — |
| F09.2 | Create service order | R2 | CLIN-001 | Not started | — | — | — |
| F09.3 | Order cancellation (reason + state guard) | R2 | CLIN-001 | Not started | — | — | — |
| EPIC-10 | Laboratory | R2 | LAB-001, DB-001 §21–§24 | Not started | — | — | — |
| F10.1 | Lab order intake | R2 | LAB-001 §9–§10 | Not started | — | — | — |
| F10.2 | Specimen collection/accession | R2 | LAB-001 §11, DB-001 §22 | Not started | — | — | — |
| F10.3 | Result entry/import | R2 | LAB-001, DB-001 §23 | Not started | — | — | — |
| F10.4 | Verify/finalize report | R2 | LAB-001, DB-001 §24 | Not started | — | — | — |
| F10.5 | Critical result acknowledgement (accountable workflow) | R2 | LAB-001, SAFE-001 | Not started | — | — | — |
| EPIC-11 | Imaging / RIS-PACS Workflow | R2 | IMG-001, DB-001 §25 | Not started | — | — | — |
| F11.1 | Imaging order/schedule | R2 | IMG-001 §7–§10 | Not started | — | — | — |
| F11.2 | Study linkage (DICOM ref, pixels stay in PACS) | R2 | IMG-001 §1, ARCH-001 §18 | Not started | — | — | — |
| F11.3 | Viewer launch (authorized) | R2 | IMG-001, IAM-001 | Not started | — | — | — |
| F11.4 | Radiology report (final/amended) | R2 | IMG-001 | Not started | — | — | — |
| EPIC-12 | Medication, Pharmacy & eMAR | R2 | MED-001, DB-001 §26–§30 | Not started | — | — | — |
| F12.1 | Medication prescribing (dose/route/frequency structured) | R2 | MED-001 §10, DB-001 §27 | Not started | — | — | — |
| F12.2 | Pharmacist verification | R2 | MED-001, DB-001 §28 | Not started | — | — | — |
| F12.3 | Dispense (batch traceable) | R2 | MED-001, DB-001 §29, INV-001 | Not started | — | — | — |
| F12.4 | eMAR schedule | R2 | MED-001, DB-001 §30 | Not started | — | — | — |
| F12.5 | Record administration | R2 | MED-001, DB-001 §30 | Not started | — | — | — |
| F12.6 | Not given/held/correction | R2 | MED-001 | Not started | — | — | — |
| ANAT | Anatomical Mapping Engine (ACME) | R2+ | ANAT-001 | Not started | — | — | — |

## R3 — Operations & Revenue

| ID | Epic / Feature | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|----------------|---------|----------|--------|--------|-------|----------|
| EPIC-13 | Inventory, Stores & Procurement | R3 | INV-001, DB-001 §31–§34 | Not started | — | — | — |
| F13.1 | Catalog/locations (UOM normalized) | R3 | INV-001 §5–§7 | Not started | — | — | — |
| F13.2 | Receive stock (batch/lot + expiry) | R3 | INV-001 §11–§13 | Not started | — | — | — |
| F13.3 | Issue/consume stock (immutable ledger) | R3 | INV-001 §8–§9 | Not started | — | — | — |
| F13.4 | Stock count/reconciliation | R3 | INV-001 | Not started | — | — | — |
| F13.5 | Procurement cycle (req → PO → receipt) | R3 | INV-001, DB-001 §34 | Not started | — | — | — |
| EPIC-14 | Billing, Payments, Insurance & Claims | R3 | REV-001, DB-001 §37–§40 | Not started | — | — | — |
| F14.1 | Charge capture (projection, never rewrites clinical) | R3 | REV-001 §4 | Not started | — | — | — |
| F14.2 | Invoice | R3 | REV-001, DB-001 §38 | Not started | — | — | — |
| F14.3 | Payment / refund / adjustment | R3 | REV-001, DB-001 §39 | Not started | — | — | — |
| F14.4 | Insurance eligibility/authorization | R3 | REV-001 §10–§11 | Not started | — | — | — |
| F14.5 | Claim lifecycle | R3 | REV-001, DB-001 §40 | Not started | — | — | — |
| EPIC-15 | Workflow, Tasks, Notifications & Documents | R3 | ARCH-001 §22–§23, DB-001 §44–§45 | Not started | — | — | — |
| F15.1 | Durable task (state machine, escalation) | R3 | ARCH-001 §22 | Not started | — | — | — |
| F15.2 | Notification delivery (async, minimum PHI) | R3 | ARCH-001 §23, EVT-001 | Not started | — | — | — |
| F15.3 | Document upload (object storage + metadata) | R3 | ARCH-001 §17, DB-001 §44 | Not started | — | — | — |
| F15.4 | Print/export (governed) | R3 | ENG-001 §88 | Not started | — | — | — |
| EPIC-20 | Reporting & Analytics (baseline) | R3/R5 | ARCH-001 §24 | Not started | — | — | — |

## R4–R6 — Network, Resilience, Specialties

| ID | Epic | Release | Spec ref | Status | Sprint | Owner | Evidence |
|----|------|---------|----------|--------|--------|-------|----------|
| EPIC-16 | Consent, Privacy & Disclosure | R4 | PRIV-001, IAM-001, DB-001 §41 | Not started | — | — | — |
| EPIC-17 | Inter-Hospital Referral & Transfer (RTX) | R4 | REF-001, DB-001 §35–§36 | Not started | — | — | — |
| EPIC-18 | FHIR / External Integration Gateway | R4 | FHIR-001, API-001 | Not started | — | — | — |
| EPIC-19 | Patient Portal & Proxy Access | R4 | UX-001, PRIV-001 | Not started | — | — | — |
| EPIC-21 | Facility Edge & Offline Resilience | R5 | ARCH-001 §13, OPS-001 | Not started | — | — | — |
| EPIC-22 | Security, Privacy & Compliance (continuous) | All | SEC-001, PRIV-001 | Not started | — | — | — |
| EPIC-23 | Observability, SRE, Backup & DR (continuous) | R0–R5 | OPS-001, NFR-001 | Not started | — | — | — |
| EPIC-24 | Migration, Onboarding & Go-Live | R5 | MIG-001, ONB-001 | Not started | — | — | — |
| EPIC-25 | Specialty Expansion (ED, theatre, ICU, dialysis, blood bank, equipment, roster) | R6 | CLIN-001, LAB-001 §3 | Not started | — | — | — |

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
