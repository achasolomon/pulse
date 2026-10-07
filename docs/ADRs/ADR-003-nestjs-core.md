# ADR-003 — NestJS + TypeScript Strict as Application Core

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-BE-001 §2, PULSE-ENG-001 §4

## Decision

NestJS 12 is the primary transactional application framework. TypeScript strict mode mandatory (`strict: true`). `nodenext` module resolution with explicit `.js` ESM imports.

Specialized services may use another language only with a dedicated ADR justifying why the core runtime is unsuitable.

## Consequences

- Global ValidationPipe (whitelist, forbidNonWhitelisted, transform), class-validator DTOs.
- Repository ports (interfaces) + DI tokens per domain; ORM entities separated from domain models (see ADR-004 for migration tooling choice, still open: TypeORM vs Prisma vs Kysely — deferred to Sprint 02, no ORM wired in Sprint 01).
