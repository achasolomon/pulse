CREATE SEQUENCE IF NOT EXISTS patient.local_mrn_sequence;
ALTER TABLE patient.patient ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE patient.patient ADD COLUMN IF NOT EXISTS contact_address text;
ALTER TABLE clin.observation ADD COLUMN IF NOT EXISTS recorded_by uuid;
CREATE TABLE IF NOT EXISTS integration.staff_command (
  organization_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  action text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,facility_id,actor_id,command_key)
);
CREATE TABLE IF NOT EXISTS encounter.outpatient_visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL UNIQUE REFERENCES encounter.encounter(id),
  organization_id uuid NOT NULL REFERENCES org.organization(id),
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  patient_id uuid NOT NULL REFERENCES patient.patient(id),
  appointment_id uuid UNIQUE REFERENCES sched.appointment(id),
  stage text NOT NULL DEFAULT 'waiting-vitals' CHECK(stage IN ('waiting-vitals','vitals-in-progress','vitals-recorded','waiting-consultation','in-consultation','completed','cancelled')),
  nurse_person_id uuid,
  clinician_person_id uuid,
  checked_in_by uuid NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outpatient_one_active_patient_idx
  ON encounter.outpatient_visit(facility_id,patient_id) WHERE stage NOT IN ('completed','cancelled');
CREATE INDEX IF NOT EXISTS outpatient_queue_idx ON encounter.outpatient_visit(facility_id,stage,checked_in_at,id);
CREATE TABLE IF NOT EXISTS encounter.outpatient_visit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES encounter.outpatient_visit(id),
  actor_id uuid NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
