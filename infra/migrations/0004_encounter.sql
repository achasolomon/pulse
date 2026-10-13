-- 0004_encounter
-- Sprint 05: encounter & ADT core (PULSE-DB-001 sections 14-15).
-- Additive only. Status history preserved via transfer rows + status column.

CREATE SCHEMA IF NOT EXISTS encounter;

CREATE TABLE IF NOT EXISTS encounter.encounter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  type text NOT NULL CONSTRAINT encounter_type_check CHECK (type IN ('outpatient', 'inpatient', 'emergency')),
  status text NOT NULL DEFAULT 'open' CONSTRAINT encounter_status_check CHECK (status IN ('open', 'admitted', 'discharged', 'cancelled')),
  department_id uuid REFERENCES org.department (id),
  bed text,
  disposition text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS encounter_patient_idx ON encounter.encounter (patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS encounter_facility_idx ON encounter.encounter (facility_id, status);
CREATE INDEX IF NOT EXISTS encounter_active_idx ON encounter.encounter (patient_id) WHERE status IN ('open', 'admitted');

-- Every admit/transfer/discharge writes a history row (never updated).
CREATE TABLE IF NOT EXISTS encounter.transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  from_department_id uuid REFERENCES org.department (id),
  to_department_id uuid REFERENCES org.department (id),
  from_bed text,
  to_bed text,
  action text NOT NULL CONSTRAINT transfer_action_check CHECK (action IN ('admit', 'transfer', 'discharge', 'cancel')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfer_encounter_idx ON encounter.transfer (encounter_id, created_at);
