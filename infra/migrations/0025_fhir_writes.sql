-- 0025_fhir_writes
-- Sprint 29: FHIR write gateway + HL7v2 adapter (FHIR-001 sections 47, 50, 62-65;
-- FHIR-SR-003/007). Additive only: origin provenance on clinical rows and a
-- partner-scoped idempotency/provenance ledger for external imports.

-- Source authority on clinical content: 'local' rows are created inside Pulse;
-- 'external' rows arrived through the partner write surface and are never
-- silently promoted to locally verified/signed (FHIR-001 section 63).
ALTER TABLE clin.entry
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'local'
  CONSTRAINT entry_origin_check CHECK (origin IN ('local', 'external'));

ALTER TABLE clin.observation
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'local'
  CONSTRAINT observation_origin_check CHECK (origin IN ('local', 'external'));

-- External import ledger: one row per accepted create (FHIR-001 section 50
-- idempotency + section 62 persist provenance). Unique (partner, resource type,
-- idempotency key) is the concurrency guard: claim is written before the
-- domain row; same key + same fingerprint replays, different fingerprint
-- conflicts (409). Keys are optional (NULL keys never collide in Postgres).
CREATE TABLE IF NOT EXISTS integration.external_resource (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES integration.partner (id),
  idempotency_key text,
  request_fingerprint text NOT NULL,
  resource_type text NOT NULL,
  method text NOT NULL DEFAULT 'fhir'
    CONSTRAINT external_resource_method_check CHECK (method IN ('fhir', 'hl7v2-oru')),
  internal_id uuid NOT NULL,
  outcome text NOT NULL
    CONSTRAINT external_resource_outcome_check CHECK (outcome IN ('created', 'replayed')),
  source_system text NOT NULL DEFAULT 'external',
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_resource_idem_unique UNIQUE (partner_id, resource_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS external_resource_internal_idx
  ON integration.external_resource (internal_id);
