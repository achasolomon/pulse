-- 0011_fhir_partners
-- Sprint 12: FHIR gateway partner registry (FHIR-001, EPIC-18 partial).
-- Additive only. Keys stored hashed; plaintext shown once at creation (app-level).

CREATE SCHEMA IF NOT EXISTS integration;

CREATE TABLE IF NOT EXISTS integration.partner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_name_unique UNIQUE (name)
);

-- FHIR access log (who pulled what, when; minimum-necessary).
CREATE TABLE IF NOT EXISTS integration.fhir_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES integration.partner (id),
  resource_type text NOT NULL,
  resource_id text,
  status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fhir_log_partner_idx ON integration.fhir_log (partner_id, created_at DESC);
