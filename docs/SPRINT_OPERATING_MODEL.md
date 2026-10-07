# Pulse — Sprint Operating Model

How we run 2-week sprints. Derived from `PULSE-BACKLOG-001 §5 DoR, §6 DoD, §14–§24, §28`, `PULSE-ENG-001 §94–§95`, `PULSE-QA-001`, `PULSE-SAFE-001`.

## 1. Cadence

- 2-week sprints. Sprint numbers are sequencing bands, not deadline promises.
- Ceremonies: planning (2h), mid-sprint clinical check (30m), review + demo (1h), retro (45m).
- Capacity: 2 streams — (A) Platform/IAM/DB, (B) Clinical slice/UI. No stream starts work that violates the dependency spine in `DEV_PHASES.md`.

## 2. Roles

- Product/Clinical informatics: owns acceptance + safety sign-off.
- Tech lead: owns domain boundaries, ADRs, PR approvals.
- QA/Safety: owns traceability req → hazard → test → release decision.
- Each story has one owning domain (per `ARCH-001 §6` ownership matrix).

## 3. Board columns

`Backlog → Ready → In progress → In review (PR + tests) → Safety/QA gate → Done`

`Blocked` is a flag, not a column. Blocked > 2 days → escalate to tech lead.

## 4. Definition of Ready (all must hold)

- [ ] Actor + outcome clear; owning domain identified
- [ ] Authoritative data owner + dependencies known
- [ ] API/event/DB impact identified
- [ ] Authz / privilege / consent impact identified
- [ ] UX states known (for UI work); failure + negative paths written
- [ ] Safety assumptions resolved or explicitly tracked

## 5. Definition of Done (all must hold)

- [ ] Respects domain ownership + parent spec
- [ ] Migration safe, reversible / forward-fixable
- [ ] API/event contracts updated + machine-readable
- [ ] Tenant/facility/patient scoping tested (incl. cross-facility denial)
- [ ] Audit/provenance implemented
- [ ] Idempotency/concurrency handled where applicable
- [ ] Unit + integration + contract + required E2E pass
- [ ] No secrets / unnecessary PHI in logs / telemetry
- [ ] Metrics/traces/health wired
- [ ] Accessibility + responsive checked (UI)
- [ ] Failure/degraded behaviour tested
- [ ] Docs/ADR/runbook updated if architecture/ops changed

## 6. Gates (cannot mark Done without evidence)

- **Clinical safety:** hazard screened; safety-critical defect stops release (`SAFE-001 §3.1`).
- **Security/privacy:** authz matrix test, minimum-necessary disclosure, break-glass audited.
- **Data:** reconciliation for migrations; no silent invention.
- **Ops:** backup/restore smoke, observability, runbook entry for new service.

## 7. Sprint file convention

Each sprint gets `docs/sprints/SPRINT_XX.md` with:

```md
# Sprint XX — <goal> (dates)
Goal:
Scope (story IDs):
Demo script:
Evidence (CI links, test reports, audit screenshots):
Carry-over:
Safety/privacy notes:
```

Planning copies story rows from `BACKLOG_TRACKER.md`; review updates their status there.

## 8. Estimation

Story points = complexity + safety risk + integration surface, not hours. Rules:
- Any story touching patient identity, orders, meds, merge, consent defaults to +2 for safety tests.
- Spikes time-boxed to 2 days; must produce ADR or prototype, not production code.

## 9. Change control

After R0 baseline freeze: scope change to released epic requires ADR + migration/contract impact note + re-validation of affected exit criteria.
