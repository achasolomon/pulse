# CR-001 — Insurance & HMO Integration Impact Assessment

**Classification:** Functional scope addition · **Status:** Assessment for review (no implementation)
**Date:** 2026-10-08 · **Author:** Engineering
**Parent specs:** PULSE-REV-001 (Billing/Payments/Insurance/Claims), PULSE-DB-001 §37–§40, PULSE-ARCH-001 §21, PULSE-IAM-001, PULSE-PRIV-001
**Constraint (directive):** No broad changes to billing/patient schemas until this assessment and the integration design are reviewed and approved. Cash workflows must keep working.

---

## 1. Current implementation inventory (verified against source)

### 1.1 Revenue module — `apps/api/src/modules/revenue/` (Sprint 10, EPIC-14 Done)

| Area | Files | What exists |
|---|---|---|
| Catalogue | `domain/revenue.repository.ts`, `infrastructure/kysely-revenue.repository.ts` (`defineService`/`findService`), `interface/dto.ts` (`DefineServiceDto`) | `rev.service`: single `code → default_price`. No payer dimension, no versions, no effective dates |
| Charge capture | `application/revenue.service.ts` (`captureCharge`), controller `POST /revenue/charges` | `rev.charge`: patient + optional encounter, free-text `service_code`, quantity, `unit_price` pinned at capture. **No responsible-party field, no tariff reference, no coverage link, no encounter-type pricing rule** |
| Invoicing | `invoice()`, `addLine()`, `balance()`, `GET /revenue/invoices/:id/balance` | `rev.invoice` + `rev.invoice_line` (charge-derived amounts). Single patient-level balance. **No split billing, no guarantor, no payer allocation** |
| Payments | `pay()`, `recordPayment`, `POST .../payments` | `rev.payment`: invoice-level, free-text `method`, completed/refunded. **No payer settlement, no remittance linkage** |
| Adjustments | `adjust()`, `rev.adjustment` | refund/write-off/correction with mandatory reason. Compliant, reusable |
| Coverage | `addCoverage`, `eligibility`, `rev.coverage` | patient + **free-text `payer`/`plan`**, member_id, date window. Local date-overlap check only. **No payer registry, no benefit rules, no verification evidence** |
| Authorization | `authorize`, `rev.authorization` | coverage + encounter, approved_amount, pending/approved/denied. Flat record. **No line-level auth, no document requests, no expiry/extension workflow** |
| Claims | `fileClaim` + `transitionClaim` machine, `rev.claim` | invoice + **free-text `payer`**, draft→submitted→acknowledged→paid/denied→appealed. **No claim lines, no payer claim IDs, no remittance/settlement, no resubmission versioning** |

Outbox facts emitted: `charge.captured`, `invoice.created`, `payment.recorded`, `invoice.adjusted`, `claim.*`. These are the natural seams for insurance integration (see §5).

### 1.2 Adjacent modules (assumptions that matter)

| Module | Relevant fact | Insurance implication |
|---|---|---|
| Patient (`modules/patient/`) | Canonical identity + MRN + merge; **no insurance/coverage linkage, no guarantor/responsible-party fields** | Registration cannot capture or select coverage; encounters cannot inherit it |
| Organization (`modules/organization/`) | org → facility → department hierarchy | Exists and suffices as the facility side of facility-payer contracts — no change needed |
| Encounter (`modules/encounter/`) | open/admit/transfer/discharge machine | Admission/authorization hooks have a clean seam (`encounter.admitted` event), but no preauth gate exists |
| Laboratory / Imaging / Medication | Order → verify → report/dispense chains with own catalogues | Charge capture is manual (`serviceCode` typed by caller). No automatic charge generation from orders/dispenses, so payer-specific pricing has nothing to hook into yet |
| IAM (`modules/iam/`) | Privilege-checked endpoints (`billing:*`, `charge:*`, `claim:*`) | New insurance privileges (`payer:*`, `preauth:*`) fit the existing model — additive |
| Audit/Outbox platform | Global `AuditInterceptor`, `OutboxService` | Any new domain inherits audit + events free; no platform change required |
| web-clinical | Static shell (sidebar, facility selector, banner) | No payer/billing screens exist — UI impact is greenfield, not rework |

### 1.3 Database entities (migration `0009_revenue.sql`)

`rev.service`, `rev.charge`, `rev.invoice`, `rev.invoice_line`, `rev.payment`, `rev.adjustment`, `rev.coverage`, `rev.authorization`, `rev.claim`. All append-only disciplines (reasoned cancel/void/refund, no deletes). **Nothing in these tables references a payer entity because none exists.**

---

## 2. Gap analysis — HMO requirements vs current state

| # | HMO requirement | Current state | Gap size |
|---|---|---|---|
| G1 | Payer registry (HMO identity, contacts, EDI endpoints, active status) | Free-text `payer` strings in 3 tables; no canonical entity | **Large — foundational** |
| G2 | Facility–payer contracts (which payers each facility accepts, effective windows) | No concept exists | **Large — foundational** |
| G3 | Payer-specific tariffs (fee schedules, versioned, service-level prices per payer/plan) | Single global `default_price`; price pinned at capture with optional override | **Large — pricing core** |
| G4 | Multiple responsible parties per charge/invoice (patient + payer + guarantor, split %/amount) | Single implicit party (the patient bill); `invoiceBalance` assumes one balance | **Large — financial model** |
| G5 | Benefit determination (deductible, copay, coinsurance, limits, exclusions per plan) | None | **Large — Phase 2** |
| G6 | Eligibility verification with evidence (request/response log, payer query, verified-by/at) | Local date check, no evidence trail | **Medium — Phase 1 needs the log at minimum** |
| G7 | Preauthorization workflow (line/сase-level request, document chase, approval/denial with expiry, extension) | Flat approved/denied record per encounter | **Medium — deepen in Phase 2; minimal case-level in Phase 1** |
| G8 | Claims with lines, payer claim IDs, resubmission versions, denial reason codes | Header-only claims, free-text denial reason | **Medium — Phase 1 lines + IDs; code sets Phase 2** |
| G9 | Remittance/settlement (ERA capture, payment-to-claim reconciliation, underpayment flags) | Payments allocate to invoices only; no claim linkage | **Large — Phase 2** |
| G10 | Guarantor / responsible party on patient account (REV-001 §8–§9) | Missing in patient and invoice models | **Medium — Phase 1** |
| G11 | Coverage selection at registration/encounter (active coverage snapshot on the visit) | No linkage | **Small — additive FKs** |
| G12 | Capitation / bundled payments | No concept exists | **Out of scope — explicit non-goal for Phase 1/2** |

**Single most blocking assumption:** price is resolved from one global catalogue at capture time and the whole invoice belongs to one implicit payer (the patient). Every HMO capability (G2–G5, G8–G9) depends on breaking that assumption via G1 first.

---

## 3. Module dependency and impact matrix

| Proposed change | Touches | Impact on completed work | Risk |
|---|---|---|---|
| New `insurance` domain module (`modules/insurance/`: payer, contract, tariff, benefit-read, preauth, allocation, claim-assembly) | New code + new `ins` schema; **reads** revenue ports, **never writes** `rev.*` directly | None — additive | Low |
| Price-resolution hook in `RevenueService.captureCharge` (optional `payerId`/`planId` → tariff lookup, else `default_price`) | One optional branch + new optional DTO fields; `rev.charge` gains **nullable** `tariff_id` | Cash path byte-identical when fields absent (pinned by existing unit/integration totals) | Low–Medium |
| Responsible-party allocation (`rev.allocation`: charge → party → share) | New table; balance math extended to per-party outstanding **alongside** (not replacing) current invoice balance | Existing `invoiceBalance` untouched; new `allocationBalance` added | Medium |
| Guarantor fields (patient + invoice, nullable) | Nullable columns + DTO fields | None when null | Low |
| Coverage selection snapshot on encounter (`encounter` nullable `coverage_id`) | Nullable column | None when null | Low |
| Eligibility verification log | New table in `ins` schema; read-only view for billing | None | Low |
| Claim lines + payer claim IDs + resubmission versions | New tables (`rev.claim_line`, `rev.claim_submission`); existing `rev.claim` untouched | None — old claims remain valid | Low–Medium |
| Remittance application | New tables + reconciliation job; reads payments/claims | None until enabled per facility | Medium |
| Automatic charge generation from lab/imaging/dispense events | Consumers of existing outbox facts (`lab.ordered`, `imaging.*`, `med.dispensed`) | **Deferred** — manual capture stays; no change to clinical modules | None (deferred) |
| UI (payer admin, eligibility check, preauth inbox, claim worklist) | `web-clinical` + `packages/ui` additions | Greenfield — no rework of shell | Low |

**What is explicitly NOT touched:** clinical workflows, patient identity/merge, encounter machine, audit/outbox platform, boundary rules, existing `rev.*` columns (no alters, only nullable additions), existing API shapes (only optional fields added).

---

## 4. Proposed independently owned Insurance & Payer domain

**New module:** `apps/api/src/modules/insurance/` — owner: payer-network team (or platform team until split). It **owns** the `ins` schema and publishes decisions; `revenue` remains the financial book of record.

**Owned entities (new `ins` schema):**
- `ins.payer` (identity, contacts, EDI endpoint refs, active flag)
- `ins.facility_contract` (facility ↔ payer, effective window, status)
- `ins.tariff_schedule` + `ins.tariff_line` (contract → service → price, versioned, effective dates; change = new version)
- `ins.plan_benefit` (plan → deductible/copay/coinsurance/limits/exclusions; Phase 2 engine, Phase 1 read-only record)
- `ins.eligibility_check` (coverage + payer query payload/response or manual evidence + verified-by/at)
- `ins.preauth_case` (case/encounter scope, line items, document requests, decision + expiry; workflow machine)
- `ins.responsibility` (charge → party[`patient`|`payer`|`guarantor`] → share %/amount + tariff applied)
- `ins.remittance` + `ins.remittance_line` (Phase 2: ERA capture → claim/payment reconciliation)

**Integration contracts (all via existing platform primitives):**
- Revenue → Insurance (outbox, already emitted): `charge.captured`, `invoice.created` → tariff/allocation evaluation
- Insurance → Revenue (application calls through ports, never direct writes): `resolvePrice(serviceCode, payerId, planId, date)` → unit price; `allocateResponsibility(chargeId, shares[])` → writes `rev.allocation` via revenue port
- Insurance publishes: `tariff.published`, `eligibility.verified`, `preauth.decided`, `claim.ready`, `remittance.applied`
- Revenue publishes (existing, unchanged): `charge.captured`, `invoice.*`, `payment.recorded`, `claim.*`
- Auth: new privileges `payer:manage`, `tariff:manage`, `preauth:decide`, `claim:submit` under existing IAM model
- FHIR (later): Coverage + ClaimResponse profiles mapped in `modules/fhir/` translation layer only

**Ownership rule (ADR-001 compliant):** insurance reads revenue ports, writes only `ins.*` + `rev.allocation` through a revenue-owned port. Revenue never imports insurance. Boundary script already enforces this direction once coded.

---

## 5. Updated patient-to-payment workflow (insured path; cash path unchanged)

```
Registration → select coverage (snapshot to encounter; skipped for cash)
  → Scheduling/Encounter (unchanged)
  → Eligibility check (ins.eligibility_check; manual evidence in Phase 1)
  → Care + Orders (unchanged clinical modules)
  → Charge capture: resolvePrice(service, payer, plan, date) → tariff or default_price
  → Responsibility allocation: payer share + patient share (+guarantor)
  → Preauth gate (if plan requires): hold billable submission until decided (care never blocked)
  → Invoice (per-party outstanding alongside current invoice balance)
  → Claim assembly (lines + payer claim ID) → submit → track → deny/appeal with codes
  → Remittance (Phase 2): payer payment → reconcile to claims → flag underpayments
  → Patient statement for residual only
```

Cash path (`payerId` absent): byte-identical to today — `default_price`, single balance, existing claim flow optional.

---

## 6. Migration and backward-compatibility strategy

1. **Additive only.** New `ins` schema tables + **nullable** columns on existing tables (`rev.charge.tariff_id`, `rev.charge.coverage_id`, `encounter.encounter.coverage_id`, guarantor fields). Zero `ALTER COLUMN`, zero renames, zero backfills-as-migration (backfill, if needed, as a separate idempotent script).
2. **Expand before contract.** Each migration (`0012_insurance_foundation.sql`, …) is independently deployable; code reads new tables with graceful absence (feature works when rows exist, cash path otherwise).
3. **API compatibility.** Only optional DTO fields added (`payerId`, `planId`, `guarantorId`); all existing request/response shapes unchanged; new endpoints under `/insurance/*` and `/revenue/*` additions.
4. **Event compatibility.** Only new event types added; no existing type altered. Consumers ignore unknown types.
5. **Cash regression gate.** Existing revenue suites stay green unmodified: unit totals (50+), `revenue.integration-spec.ts` money chain (totals 15000/partial/paid/refund), e2e 403/400s. New tests assert: (a) cash capture without `payerId` yields identical amounts; (b) tariff path yields contract price; (c) allocation sums to invoice total (invariant test).
6. **Rollback.** Each phase is independently reversible: drop new endpoints + ignore new tables; cash flows never depend on `ins.*` rows.

---

## 7. Phased implementation, estimates, dependencies, risks

### Phase 1 — First insurance-enabled release (proposed Sprint 13–14, ~2 sprints)

Minimum viable: payer registry + facility contracts + tariff schedules with versioned prices; `resolvePrice` hook (nullable fields); responsibility allocation + per-party outstanding; guarantor fields; coverage snapshot on encounter; manual eligibility capture with evidence log; claim lines + payer claim IDs + resubmission versions; payer admin + eligibility + claim-worklist UI stubs.
**Depends on:** this assessment's approval + one ADR (insurance domain boundary). No other module changes.

### Phase 2 — Deepening (2–3 sprints, after Phase 1 live)

Benefit engine (deductible/copay/coinsurance posting as allocation rules), preauth document-chase workflow, denial reason code sets, EDI claim submission + remittance ingestion with reconciliation, automatic charge generation from clinical outbox events, patient statements/portal billing views.

### Explicit non-goals

Capitation/bundled payments, fraud analytics, multi-currency, real-time payer API integrations (beyond file/portal upload in Phase 1).

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tariff versioning disputes (which price applied when) | High | Price pinned at capture with `tariff_id` + effective-date rule; allocation invariant tests |
| Allocation math drift (splits ≠ total) | Medium | `sum(shares) == invoice total` CHECK + invariant tests on every write path |
| Scope creep into clinical modules (auto-charging) | Medium | Deferred by design; manual capture remains; auto-generation is a separate CR |
| Payer data quality (free-text legacy payers) | High | Registry seeding as governed migration with de-duplication review, not silent mapping |
| Performance on balance endpoints (per-party math) | Low | Derived read models + existing partial indexes; measured before optimizing |

---

## 8. Regression test coverage (affected workflows)

- **Unchanged, must stay green:** all revenue unit specs (balance math, claim machine), `revenue.integration-spec.ts` (15000/partial/paid/refund + encounter-untouched assertion), e2e revenue 403/400s, patient/encounter suites (no schema change to their tables).
- **New:** tariff resolution matrix (payer × plan × date → price, fallback to default), allocation invariant (splits sum to total), consent-style gate test for preauth-hold vs care-continuation, claim resubmission version chain, eligibility evidence-required test, cash-parity test (same capture with/without `payerId` except price source).
- **Gate for Phase 1 release:** full suite (unit + e2e + `test:int` incl. new `insurance.integration-spec.ts`) green + `tsc` + `oxlint` + boundaries clean, per Definition of Done.

---

## 9. Recommendation for the next sprint

**Sprint 13 — Insurance foundation (additive, zero-risk), gated on approval of §§4–6:**

1. Approve this assessment + record **ADR-007** (insurance domain boundary, ownership, `ins` schema, integration contracts above).
2. Land migration `0012_insurance_foundation.sql`: `ins.payer`, `ins.facility_contract`, `ins.tariff_schedule`, `ins.tariff_line` (+ nullable `rev.charge.tariff_id`). No behavior change; cash paths untouched.
3. Ship read-only seams: payer/contract/tariff CRUD behind `payer:manage`, plus `resolvePrice()` used by nothing yet (dark code with unit tests).
4. Defer to Sprint 14 (requires Phase-1 design sign-off): allocation writes, coverage snapshot, eligibility log, claim lines, preauth case machine.

**Estimated Sprint 13 delta:** 1 migration + 1 module skeleton + ~6 endpoints + unit/integration specs, following the established Sprint 03–12 pattern (port → Kysely repo → service → guarded controller → specs → live-DB proof). No existing file modified except additive DTO fields and `app.module.ts` wiring.
