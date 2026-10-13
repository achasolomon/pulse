-- Sprint 34: dialysis / renal recurring-care slice (EPIC-25, CLIN-001 22/23).
-- Protocol versions are immutable; sessions snapshot the protocol version used.

CREATE SCHEMA IF NOT EXISTS dial;

CREATE TABLE dial.protocol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  name text NOT NULL,
  session_minutes integer NOT NULL DEFAULT 240 CHECK (session_minutes > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_version_unique UNIQUE (code, version)
);

CREATE TABLE dial.program (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  protocol_id uuid NOT NULL REFERENCES dial.protocol (id),
  access_type text NOT NULL
    CONSTRAINT program_access_check CHECK (access_type IN ('fistula', 'graft', 'catheter', 'peritoneal')),
  target_weight_kg numeric(5, 1) NOT NULL
    CONSTRAINT program_target_weight_check CHECK (target_weight_kg >= 20 AND target_weight_kg <= 250),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT program_status_check CHECK (status IN ('active', 'paused', 'closed')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX program_patient_idx ON dial.program (patient_id, status);
CREATE INDEX program_facility_idx ON dial.program (facility_id, status);

CREATE TABLE dial.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES dial.program (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  protocol_id uuid NOT NULL REFERENCES dial.protocol (id),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CONSTRAINT session_status_check
      CHECK (status IN ('scheduled', 'in_progress', 'completed', 'deferred', 'cancelled')),
  pre_weight_kg numeric(5, 1),
  post_weight_kg numeric(5, 1),
  ultrafiltration_l numeric(5, 2),
  adverse_event text,
  reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_weights_pair_check
    CHECK ((pre_weight_kg IS NULL) = (post_weight_kg IS NULL)),
  CONSTRAINT session_completed_weights_check
    CHECK (status <> 'completed' OR (pre_weight_kg IS NOT NULL AND post_weight_kg IS NOT NULL))
);

CREATE INDEX session_program_idx ON dial.session (program_id, scheduled_for);
CREATE INDEX session_status_idx ON dial.session (status, scheduled_for);

-- Seeded protocol versions (v1; amendments add v2+ rows, never edit in place).
INSERT INTO dial.protocol (code, version, name, session_minutes) VALUES
  ('HD-STD', 1, 'Standard haemodialysis', 240),
  ('HDF', 1, 'Haemodiafiltration', 240);
