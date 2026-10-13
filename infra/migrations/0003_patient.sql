-- 0003_patient
-- Sprint 04: patient identity (PULSE-DB-001 sections 11-13, 66; FHIR-001 section 8).
-- Additive only. Facility-scoped MRN uniqueness. Retired rows kept, never deleted.

CREATE SCHEMA IF NOT EXISTS patient;

CREATE TABLE IF NOT EXISTS patient.patient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- canonical demographics (minimum set; history deferred)
  family_name text NOT NULL,
  given_name text NOT NULL,
  date_of_birth date NOT NULL,
  sex text NOT NULL CONSTRAINT patient_sex_check CHECK (sex IN ('M', 'F', 'O', 'U')),
  -- owning facility for the primary record (legal record boundary stays facility-aware)
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  -- lifecycle: active | retired-duplicate
  status text NOT NULL DEFAULT 'active' CONSTRAINT patient_status_check CHECK (status IN ('active', 'retired-duplicate')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_facility_idx ON patient.patient (facility_id);
CREATE INDEX IF NOT EXISTS patient_name_idx ON patient.patient (family_name, given_name);
CREATE INDEX IF NOT EXISTS patient_dob_idx ON patient.patient (date_of_birth);

-- Business identifiers with explicit namespace/system (MRN + external). Never the PK.
CREATE TABLE IF NOT EXISTS patient.identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  system text NOT NULL,
  value text NOT NULL,
  facility_id uuid REFERENCES org.facility (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identifier_value_present CHECK (value <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS identifier_system_value_uidx
  ON patient.identifier (system, value, facility_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS identifier_patient_idx ON patient.identifier (patient_id);
CREATE INDEX IF NOT EXISTS identifier_value_idx ON patient.identifier (value);

-- Governed merge links: duplicate -> survivor. Both rows retained.
CREATE TABLE IF NOT EXISTS patient.merge_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id uuid NOT NULL REFERENCES patient.patient (id),
  duplicate_id uuid NOT NULL REFERENCES patient.patient (id),
  reason text NOT NULL,
  merged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merge_not_self CHECK (survivor_id <> duplicate_id),
  CONSTRAINT merge_pair_unique UNIQUE (survivor_id, duplicate_id)
);
