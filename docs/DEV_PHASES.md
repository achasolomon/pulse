# Pulse — Development Phases (R0 → R6)

Source of truth for sequencing: `PULSE-BACKLOG-001 §2 Release Train`, `§3 Dependency Spine`, `PULSE-ARCH-001`, `PULSE-ENG-001`, `PULSE-BE-001`.
Status field is manually updated each sprint review. Do not delete rows — move status forward only.

Legend: `Not started | In progress | In review | Done | Blocked`

## Release overview

| Release | Objective | Principal scope | Exit evidence | Status |
|---------|-----------|----------------|---------------|--------|
| R0 — Engineering Foundation | Make the system buildable, testable, deployable | Monorepo, CI, local infra, config, logging, DB migration, API conventions, auth skeleton, design system | Clean pipeline; reproducible env; baseline gates pass | In progress (Sprint 01) |
| R1 — Core Clinical Record | Prove patient-to-consultation slice | Org/facility, IAM, patient identity, scheduling/queue, encounter/ADT, vitals, clinical notes, audit/events | End-to-end visit demo + negative/security tests | Not started |
| R2 — Diagnostics & Medication | Order-to-result, order-to-admin | Lab, imaging workflow, prescribing, verification, dispensing, eMAR, terminology | Validated diagnostic + medication workflows | Not started |
| R3 — Operations & Revenue | Run facility operations | Inventory/procurement, billing/payments, insurance/claims, wards/beds, documents/workflow/notifications | Clinical + stock + financial reconciliation demo | Not started |
| R4 — Referral Network & Patient Access | Connect facilities + patients | RTX exchange, consent/disclosure, patient portal, FHIR/HL7/DICOM gateway | Cross-facility exchange + portal validated | Not started |
| R5 — Resilience & Scale | Pilot readiness | Edge/offline, migration, DR, observability, perf, security validation, onboarding | Pilot readiness review passed | Not started |
| R6 — Specialty Expansion | Extend after core stable | Emergency, theatre, ICU, dialysis, blood bank, equipment, workforce, research | Specialty safety/UAT evidence | Not started |

## Dependency spine (must build in this order)

```
Engineering foundation
→ Organization / Tenant / Facility
→ Identity + Membership + Clinical Privileges
→ Patient Identity
→ Scheduling / Queue
→ Encounter / ADT
→ Triage / Vitals + Clinical Documentation
→ Orders
   ├── Laboratory
   ├── Imaging
   └── Medication / Pharmacy / eMAR
→ Inventory + Revenue + Workflow
→ Referral Exchange + Consent + Portal
→ Edge / Offline + Production Hardening
```

Rule: never start a lower layer before the layer above has its contract + authz + audit + tests merged.

## Phase breakdown

### Phase 0 — R0 Foundation (Sprints 1–2)
Goal: reproducible dev + CI + platform primitives.
Specs: ENG-001 §6–§10, BE-001 §4–§11, DB-001 §3–§10, API-001 §3–§8, EVT-001 §7, UX/FE-001 shell.
Deliverables:
- `apps/api` bootstrap: typed config, validation, exception filter, request-context, `/api/v1`, health/readiness, helmet, idempotency-key, correlation logging
- `packages/*` skeletons: `ui` (brand tokens), `api-contracts`, `events`, `config`, `testkit`, `observability`
- `infra/` docker-compose: Postgres 16, Redis, MinIO, Mailhog; migration framework (expand/contract)
- CI: build, lint (type-aware), typecheck, unit, integration, boundary-lint, container build
- ADRs 001–005 (monolith-modular, Postgres authoritative, NestJS, outbox, FHIR-at-gateway)
Exit: fresh clone → `pnpm install && pnpm build && pnpm test` green; health endpoint live.

### Phase 1 — R1 Core Record (Sprints 3–6)
Epics: 02 Org/Facility, 03 IAM, 04 Patient, 05 Scheduling, 06 Encounter/ADT, 07 Triage/Nursing, 08 Notes/Problems.
First vertical slice (BACKLOG-001 §12–§13): register → encounter → SOAP sign → timeline, with facility scoping + audit + outbox event.
Do not proceed to R2 until §13 exit criteria all pass.

### Phase 2 — R2 Diagnostics & Meds (Sprints 7–10)
Epics: 09 Orders/Terminology, 10 Lab, 11 Imaging, 12 Medication/eMAR.
Key safety gates: terminology-versioned catalogues, specimen chain, critical-result acknowledgement, prescription→verify→dispense→admin separation, reconciliation at transitions. Pixels stay in PACS; Pulse stores references + reports only.

### Phase 3 — R3 Operations (Sprints 11–14)
Epics: 13 Inventory, 14 Revenue, 15 Workflow/Tasks/Notify/Documents, 20 Reporting (baseline).
Key rule: clinical truth ≠ financial/stock truth. Payment never rewrites encounter; stock ledger immutable; charge capture is projection of clinical events.

### Phase 4 — R4 Network (Sprints 15–18)
Epics: 16 Consent/Privacy, 17 RTX Referral, 18 FHIR/Integration, 19 Portal.
Governed exchange only — no cross-facility DB visibility. Consent + disclosure manifest enforced server-side. FHIR R4 at gateway; internal models stay domain-native.

### Phase 5 — R5 Hardening (Sprints 19–21)
Epics: 21 Edge/Offline, 22 Security, 23 Observability/SRE/DR, 24 Migration/Onboarding.
Pilot readiness: SLOs, backup/PITR + restore drill, perf baselines, threat-model validation, facility discovery → training → cutover rehearsal.

### Phase 6 — R6 Specialties (post-pilot)
Epic 25 only after R1–R5 stable + safety case signed.

## How to update this file
- Sprint planning: move selected epics to `In progress`, link sprint file in `docs/sprints/`.
- Sprint review: flip to `Done` only when Definition of Done + gate evidence met (see `SPRINT_OPERATING_MODEL.md`).
- Never edit scope column without ADR + backlog change record.
