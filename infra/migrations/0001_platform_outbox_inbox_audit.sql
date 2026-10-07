-- 0001_platform_outbox_inbox_audit
-- Sprint 01 decision artifact per ADR-006 / PULSE-DB-001 sections 47-48, 42.
-- Plain-SQL, reviewable, expand/contract compatible. No destructive DDL.
-- Apply: psql $DATABASE_URL -f infra/migrations/0001_platform_outbox_inbox_audit.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS audit;

-- Transactional outbox: domain state + event row commit atomically (ADR-004).
CREATE TABLE IF NOT EXISTS integration.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  type text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  producer text NOT NULL,
  correlation_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT outbox_version_positive CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON integration.outbox (created_at, id)
  WHERE published_at IS NULL;

-- Consumer inbox / idempotency for at-least-once delivery.
CREATE TABLE IF NOT EXISTS integration.inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  consumer text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_event_once UNIQUE (event_id, consumer)
);

-- Append-only audit evidence (no UPDATE/DELETE for application roles; enforced in app + later RLS).
CREATE TABLE IF NOT EXISTS audit.audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  tenant_id uuid,
  facility_id uuid,
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_resource_idx
  ON audit.audit_event (resource_type, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx
  ON audit.audit_event (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_tenant_facility_idx
  ON audit.audit_event (tenant_id, facility_id, occurred_at DESC);
