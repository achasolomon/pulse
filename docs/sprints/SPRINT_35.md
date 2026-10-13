# Sprint 35 — Equipment / asset management (EPIC-25)

**Status:** done
**Epic:** EPIC-25 — Specialty Expansion (R6). ED (S21), theatre (S23), blood bank (S24), dialysis (S34) done.
**Specs:** INV-001 §40 Equipment/Asset Handoff (commissioning handoff from inventory; PO/receipt stays linked to asset; serial/manufacturer/model captured; preventive maintenance, calibration, downtime, lifecycle in equipment domain; consumable spare parts remain inventory items; asset disposal coordinated with — but distinct from — stock write-off).

## Scope

- [x] Migration `0030_equipment.sql` (`eqp` schema): `eqp.asset` (facility, name, manufacturer, model, serial UNIQUE, optional `purchase_order_id` FK → `inv.purchase_order`, status in_service | out_of_service | retired with DB CHECKs tying retired→retired_at and out_of_service→reason+since), `eqp.maintenance_task` (kind preventive|calibration|corrective, due_at, status scheduled|completed|cancelled, optional `interval_days` recurrence, completed CHECK).
- [x] Domain: `ASSET_TRANSITIONS` (in_service ⇄ out_of_service; both → retired; retired terminal) + `isOverdue` pure helper (scheduled AND due_at in the past) — overdue is computed, never stored.
- [x] Module `equipment` (`EQUIPMENT_REPOSITORY` port + Kysely repo + service + guarded controller): commission (validates optional PO link via inventory port `findPurchaseOrder`), list/get assets; out-of-service (reason required) / back-to-service / retire (cancels open tasks); schedule/list/complete/cancel maintenance (completion with `interval_days` auto-schedules the next occurrence). Privileges `equipment:read`/`equipment:manage`; audited writes; outbox events.
- [x] Guards: duplicate serial 409 SERIAL_EXISTS; unknown PO 404 PURCHASE_ORDER_NOT_FOUND; downtime reason ≥5 chars 400 DOWNTIME_REASON_REQUIRED; retired assets refuse maintenance (409 ASSET_STATE_INVALID); non-scheduled tasks refuse complete/cancel (409 TASK_STATE_INVALID); unknown asset/task 404.
- [x] Tests: unit (2 specs, 6 tests: transitions+overdue pure; service fakes for serial/PO guards, downtime roundtrip, terminal retirement, recurrence, retire-cancels-tasks), integration live PG (2: full chain commission→downtime→recurrence→overdue flags→retire + outbox events; guard battery), e2e DB-less (4 × 403/400 above sentinel).

## Non-goals

- Spare-part BOMs / maintenance work orders (workflow.task), location/ward assignment per asset, rental/lease lifecycle, depreciation (finance), stock write-off itself (inventory domain keeps it — coordination is an outbox event contract only), equipment request/issue flows (INV-001 §39 is a later inventory sprint).

## Decisions

- **D1** — `findPurchaseOrder(id)` added to the inventory port (read-only): commissioning validates the PO link cross-domain through DI (`INVENTORY_REPOSITORY` exported by InventoryModule), keeping the FK honest instead of trusting client input. No inventory behavior changed; its unit fake gained `async () => undefined`.
- **D2** — Overdue is derived at read time (`isOverdue`: scheduled AND past due), never a stored flag — a cron-less design that cannot drift from the clock; returned as `overdue` on list responses only.
- **D3** — Completion of a recurring task (`interval_days` set) auto-schedules the next occurrence anchored to the previous `due_at` + interval, and emits `equipment.maintenance_scheduled` for it — recurrence lives in the equipment domain, not in scheduler infrastructure.
- **D4** — Retirement is terminal and cancels all open (scheduled) maintenance in the same operation, with `cancelledTasks` counted in the outbox payload: an asset leaving service cannot leave phantom due-dates behind. Disposal ≠ stock write-off (INV-001 §40): inventory write-off stays in its domain.
- **D5** — Bug fixed during live proof: status transitions originally returned a spread of the *pre-update* asset snapshot (stale downtime fields); service now re-fetches after update so responses reflect DB truth.

## Evidence (live proof, container `pulse-pg-s35`)

| Gate | Result |
|---|---|
| Migration | `0001`→`0030` applied on fresh DB |
| Integration (live PG) | **71/71 across 31 files**, 2nd consecutive run on same DB (idempotent); `equipment.integration-spec.ts` 2/2 (commission with PO link + serial/PO guards, downtime reason + roundtrip, maintenance recurrence dueAt+90d, overdue flags, retire cancels tasks, outbox: commissioned/out_of_service/in_service/maintenance_scheduled/completed/retired; guard battery: 404×2, 409 state rules, 400 short reason) |
| Unit | **250/250** across 51 files (equipment: 6 across 2 specs) |
| e2e | **93/93** (+4 equipment 403/400 above sentinel) |
| tsc / oxlint / boundaries / secrets | clean (oxlint 0/0 on 302 files after fixing 1 useless-spread warning; boundaries 214; secrets clean) |
| SCA | run; known triaged debt unchanged (critical/high owned by api-platform — follow-on) |
| Build | `pnpm build` 9/9 |

## Follow-ons

- Remaining EPIC-25: ICU/HDU bed-flow, roster/workforce (ARCH-001), research governance.
- Maintenance work orders via workflow.task; asset location/ward assignment; spare-part BOM links to inv.item; asset label/print + barcode; periodic overdue sweep (SRE-style evaluate) instead of read-time only.
