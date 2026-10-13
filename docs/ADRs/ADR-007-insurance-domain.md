# ADR-007 — Insurance & Payer Domain Boundary

- Status: Accepted (implements CR-001 §§4–6 as approved)
- Date: 2026-10-08
- Context: CR-001, PULSE-REV-001, PULSE-ARCH-001 §21, ADR-001, ADR-004, ADR-006

## Decision

New independently owned domain `apps/api/src/modules/insurance/` owning a new `ins` schema. It publishes pricing/allocation decisions; `revenue` remains the financial book of record.

## Ownership and dependency direction

- Insurance **reads** revenue ports (charge/invoice state) and **writes** only `ins.*` directly.
- The single cross-write (`rev.charge.tariff_id`, later `rev.allocation` rows) goes through a **revenue-owned port** — revenue never imports insurance. The boundary script enforces this.
- Price resolution is a pure function of (serviceCode, payerId, planId, date) → unit price, falling back to the catalogue `default_price` when no contract/tariff matches. Cash path (no `payerId`) is byte-identical to today.

## Schema discipline

- New `ins` tables only, plus **nullable** columns on existing tables (`rev.charge.tariff_id`). No alters, renames, or backfills-as-migration.
- Tariff change = new schedule version with effective dates; price pinned at capture with the applied `tariff_id` for dispute resolution.
- Allocation invariant: `sum(shares) == invoice total`, enforced by test on every write path once allocation lands (Sprint 14).

## Consequences

- Sprint 13: `0012_insurance_foundation.sql` (`ins.payer`, `ins.facility_contract`, `ins.tariff_schedule`, `ins.tariff_line` + nullable `rev.charge.tariff_id`); read-only CRUD + dark `resolvePrice()` (called by nothing yet).
- Sprint 14 (requires Phase-1 design sign-off): allocation writes, coverage snapshot, eligibility log, claim lines, preauth case machine.
