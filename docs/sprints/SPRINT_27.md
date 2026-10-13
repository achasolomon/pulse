# Sprint 27 — Department / Location Hierarchy (F02.2)

Goal: model the facility → department → unit → location hierarchy from ARCH-001 §6 and DB-001 §9–§10, so membership and care-assignment scope can address a precise place (not just a facility). Status: Done

Specs: ARCH-001 §6, DB-001 §9–§10, CLIN-001 (facility profiles), IAM-001 §5 (scoped membership)

## Scope

- [x] Migration `0023_dept_location_hierarchy.sql`: extend `org.department` (optional `parent_department_id` self-FK for nesting), add `org.unit` and `org.location` (facility-scoped, kind enum), additive indexes only.
- [x] Domain types (`domain/types.ts`): `Department` (+`parentDepartmentId?`), new `Unit`, `Location` (with `LocationKind`).
- [x] Repository port + Kysely impl: `createDepartment`, `listDepartments`, `createUnit`, `listUnits`, `createLocation`, `listLocations`; validate parent stays in the same facility (no cross-facility nesting, no self-parent — self-parent is prevented by the DB FK).
- [x] Service + guarded controller endpoints (TenantContextGuard + `facility:manage` for writes, `facility:read` for lists): department create/list under facility, unit create/list under facility, location create/list under unit. Outbox events on create (`department.created`, `unit.created`, `location.created`).
- [x] DTOs: `CreateDepartmentDto`, `CreateUnitDto`, `CreateLocationDto` (name/code validators, `kind` enum `bed|room|theatre|clinic|other`).
- [x] `db.types.ts`: register `org.unit`, `org.location`; `DepartmentRow` gains `parent_department_id`.
- [x] Tests: unit (existing org spec, repo stub extended), integration live PG (hierarchy round-trip + events + cross-facility rejections), e2e (context-required + privilege + 400 on bad code for department/unit/location).

## Non-goals

- Rename/move of an existing department/unit/location (JML transfer workflow), cross-facility roll-up, per-location privileges (membership stays department-scoped for now).

## Decisions

- `org.department.parent_department_id` is an optional self-FK; a department may be its own parent is prevented by the FK (not an explicit service check). Parent must belong to the same facility, enforced in the service by resolving the parent against `listDepartments(facilityId)`.
- `org.unit` is facility-scoped (no parent unit); `org.location` is unit-scoped and carries `facility_id` for denormalized access. Location kind is a constrained enum, not free text.
- Membership stays department-scoped for now; unit/location are the physical address for clinical placement (encounter bed/theatre) and future per-location privileges.
- Bootstrap-safe: creating the first organization is tenant-guard exempt (same as before); department/unit/location creation always requires tenant + facility context and `facility:manage` privilege.

## Evidence (live PG `pulse-pg-s27`, migrations 0001–0023)

- Unit: 148/148 (`vitest run`), incl. org service spec (repo stub extended for new methods).
- E2e: 58/58 (`vitest.config.e2e.ts`, no DB), incl. 4 new tests (department/unit/location context-required + 400 on bad code).
- Integration live: 45/45 (`vitest.config.int.ts`, `pulse-pg-s27` on 5433), incl. 3 new tests in `org-hierarchy.integration-spec.ts` (facility → department → unit → location + outbox facts; cross-facility parent department rejected; cross-facility unit for location rejected).
- Gates: `tsc --noEmit` 0; `oxlint --type-aware` 0 warnings / 0 errors (233 files); `check-boundaries` ok (173 files); `check-secrets` clean; `pnpm build` 9/9.
- Teardown: `docker rm -f pulse-pg-s27`; `apps/api/tsconfig.build.tsbuildinfo` restored.

