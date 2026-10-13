-- 0012_insurance_foundation
-- Sprint 13: insurance foundation (CR-001 sections 4-6, ADR-007).
-- Additive only: new ins schema + one nullable column. No alters, no backfills.

CREATE SCHEMA IF NOT EXISTS ins;

-- Canonical payer registry (replaces free-text payer strings over time).
CREATE TABLE IF NOT EXISTS ins.payer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ins_payer_code_unique UNIQUE (code)
);

-- Facility-payer acceptance contracts with effective windows.
CREATE TABLE IF NOT EXISTS ins.facility_contract (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  payer_id uuid NOT NULL REFERENCES ins.payer (id),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CONSTRAINT contract_status_check CHECK (status IN ('active', 'suspended', 'terminated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_payer_unique UNIQUE (facility_id, payer_id, effective_from)
);
CREATE INDEX IF NOT EXISTS contract_facility_idx ON ins.facility_contract (facility_id, status);

-- Versioned tariff schedules per contract (change = new version, never overwrite).
CREATE TABLE IF NOT EXISTS ins.tariff_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES ins.facility_contract (id),
  version integer NOT NULL DEFAULT 1,
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_version_positive CHECK (version >= 1),
  CONSTRAINT schedule_version_unique UNIQUE (contract_id, version)
);

-- Service-level prices within a schedule version.
CREATE TABLE IF NOT EXISTS ins.tariff_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES ins.tariff_schedule (id),
  service_code text NOT NULL,
  price numeric NOT NULL CONSTRAINT tariff_price_nonneg CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_line_unique UNIQUE (schedule_id, service_code)
);
CREATE INDEX IF NOT EXISTS tariff_line_lookup_idx ON ins.tariff_line (service_code);

-- Price pinned at capture for dispute resolution (nullable: cash path leaves it null).
ALTER TABLE rev.charge ADD COLUMN IF NOT EXISTS tariff_id uuid REFERENCES ins.tariff_line (id);
