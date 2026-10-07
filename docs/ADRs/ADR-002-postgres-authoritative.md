# ADR-002 — PostgreSQL Authoritative, Redis Never Truth

- Status: Accepted
- Date: 2026-10-07
- Context: PULSE-DB-001 §2–§3, PULSE-ARCH-001 §7, PULSE-BE-001 §17

## Decision

- PostgreSQL 16 is the authoritative relational store for all transactional clinical, stock-ledger, financial, and audit facts.
- Redis-class tech is cache/queue support only. It never becomes clinical truth.
- Object storage (S3-compatible) owns documents/media blobs; Postgres owns metadata.
- PACS/VNA remains imaging pixel authority; Pulse stores references + reports.

## Schema rules

- One owner per domain via Postgres schemas (`iam, org, patient, encounter, clinical, lab, imaging, medication, inventory, referral, revenue, consent, workflow, documents, audit, integration`).
- Opaque UUID PKs, UTC instants + clinical effective time, no hard-delete of signed/ledger/audit facts, expand/contract migrations.
