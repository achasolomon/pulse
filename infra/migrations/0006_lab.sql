-- 0006_lab
-- Sprint 07: laboratory (LAB-001 sections 6-11, DB-001 sections 21-24).
-- Additive only. Catalogue versioned; results versioned; verification immutable.

CREATE SCHEMA IF NOT EXISTS lab;

-- Versioned test catalogue (retiring never invalidates history: orders pin version).
CREATE TABLE IF NOT EXISTS lab.test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  specimen_requirement text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_test_version_positive CHECK (version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_code_version_uidx ON lab.test (code, version);

-- Laboratory order (generic order semantics: F09.2/F09.3).
CREATE TABLE IF NOT EXISTS lab.lab_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  test_id uuid NOT NULL REFERENCES lab.test (id),
  test_version integer NOT NULL,
  urgency text NOT NULL DEFAULT 'routine' CONSTRAINT lab_order_urgency_check CHECK (urgency IN ('stat', 'urgent', 'routine')),
  indication text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ordered' CONSTRAINT lab_order_status_check CHECK (status IN ('ordered', 'collected', 'accessioned', 'resulted', 'verified', 'cancelled')),
  cancel_reason text,
  verified_by uuid,
  verified_at timestamptz,
  critical_ack_by uuid,
  critical_ack_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_order_patient_idx ON lab.lab_order (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_order_encounter_idx ON lab.lab_order (encounter_id);
CREATE INDEX IF NOT EXISTS lab_order_worklist_idx ON lab.lab_order (status, created_at)
  WHERE status IN ('ordered', 'collected', 'accessioned', 'resulted');

-- Specimen chain (one row per collection try; add-ons reference suitable specimens).
CREATE TABLE IF NOT EXISTS lab.specimen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab.lab_order (id),
  container text NOT NULL,
  label text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specimen_order_idx ON lab.specimen (order_id);

-- Versioned results (amendments are new versions, never overwrites).
CREATE TABLE IF NOT EXISTS lab.result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab.lab_order (id),
  component text NOT NULL,
  value_text text NOT NULL,
  unit text,
  flag text CONSTRAINT lab_result_flag_check CHECK (flag IS NULL OR flag IN ('normal', 'high', 'low', 'critical')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_result_version_positive CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS result_order_idx ON lab.result (order_id, version DESC);
