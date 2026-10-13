-- 0005_sched_clinical
-- Sprint 06: scheduling + vitals + clinical notes (DB-001 sections 16-20).
-- Additive only. Signed notes immutable (no UPDATE path in app; status flip once).

CREATE SCHEMA IF NOT EXISTS sched;
CREATE SCHEMA IF NOT EXISTS clin;

CREATE TABLE IF NOT EXISTS sched.appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  department_id uuid REFERENCES org.department (id),
  scheduled_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled' CONSTRAINT appt_status_check CHECK (status IN ('scheduled', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appt_facility_idx ON sched.appointment (facility_id, scheduled_at);
CREATE INDEX IF NOT EXISTS appt_patient_idx ON sched.appointment (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS appt_queue_idx ON sched.appointment (facility_id, status, scheduled_at)
  WHERE status IN ('scheduled', 'checked-in', 'in-progress');

CREATE TABLE IF NOT EXISTS clin.observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  code text NOT NULL,
  value_num double precision,
  value_text text,
  unit text,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obs_value_present CHECK (value_num IS NOT NULL OR value_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS obs_patient_idx ON clin.observation (patient_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS obs_encounter_idx ON clin.observation (encounter_id, taken_at);

CREATE TABLE IF NOT EXISTS clin.note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  author_id uuid,
  chief_complaint text NOT NULL DEFAULT '',
  history text NOT NULL DEFAULT '',
  examination text NOT NULL DEFAULT '',
  assessment text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CONSTRAINT note_status_check CHECK (status IN ('draft', 'signed')),
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_patient_idx ON clin.note (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS note_encounter_idx ON clin.note (encounter_id);

CREATE TABLE IF NOT EXISTS clin.note_addendum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES clin.note (id),
  text text NOT NULL CONSTRAINT addendum_text_present CHECK (text <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addendum_note_idx ON clin.note_addendum (note_id, created_at);

CREATE TABLE IF NOT EXISTS clin.entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  kind text NOT NULL CONSTRAINT entry_kind_check CHECK (kind IN ('problem', 'allergy', 'diagnosis')),
  code text,
  display text NOT NULL,
  status text NOT NULL DEFAULT 'active' CONSTRAINT entry_status_check CHECK (status IN ('active', 'resolved')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entry_patient_idx ON clin.entry (patient_id, kind, recorded_at DESC);
