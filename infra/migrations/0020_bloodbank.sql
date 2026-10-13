-- 0020_bloodbank
-- Sprint 24: blood bank & transfusion safety (R6, LAB-001 section 3 deferral).
-- Additive only. Compatibility is enforced in code AND restated as CHECKs.

CREATE SCHEMA IF NOT EXISTS bank;

-- Donated units (bag identity unique; status lifecycle).
CREATE TABLE IF NOT EXISTS bank.unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id text NOT NULL,
  abo text NOT NULL CONSTRAINT unit_abo_check CHECK (abo IN ('O', 'A', 'B', 'AB')),
  rh text NOT NULL CONSTRAINT unit_rh_check CHECK (rh IN ('+', '-')),
  expires_on date NOT NULL,
  status text NOT NULL DEFAULT 'collected' CONSTRAINT unit_status_check CHECK (status IN ('collected', 'tested', 'available', 'reserved', 'issued', 'transfused', 'expired', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_bag_unique UNIQUE (bag_id)
);
CREATE INDEX IF NOT EXISTS unit_group_idx ON bank.unit (abo, rh, status);

-- Crossmatch: patient x unit compatibility verdict (required before issue).
CREATE TABLE IF NOT EXISTS bank.crossmatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  unit_id uuid NOT NULL REFERENCES bank.unit (id),
  result text NOT NULL CONSTRAINT xm_result_check CHECK (result IN ('compatible', 'incompatible')),
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xm_patient_unit_idx ON bank.crossmatch (patient_id, unit_id, created_at DESC);

-- Transfusion administration with monitoring + reaction handling.
CREATE TABLE IF NOT EXISTS bank.transfusion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  unit_id uuid NOT NULL REFERENCES bank.unit (id),
  status text NOT NULL DEFAULT 'started' CONSTRAINT txn_status_check CHECK (status IN ('started', 'completed', 'stopped')),
  reaction text CONSTRAINT txn_reaction_check CHECK (reaction IS NULL OR reaction IN ('none', 'mild', 'moderate', 'severe')),
  reaction_note text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT txn_unit_once UNIQUE (unit_id)
);
