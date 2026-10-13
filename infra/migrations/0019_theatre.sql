-- 0019_theatre
-- Sprint 23: theatre perioperative slice (R6, CLIN-001 theatre paths).
-- Additive only. Checklist stages are append-only; completion requires sign-out.

CREATE SCHEMA IF NOT EXISTS theat;

CREATE TABLE IF NOT EXISTS theat.suite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suite_facility_code_unique UNIQUE (facility_id, code)
);

CREATE TABLE IF NOT EXISTS theat.booking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  suite_id uuid NOT NULL REFERENCES theat.suite (id),
  procedure_name text NOT NULL,
  urgency text NOT NULL DEFAULT 'elective' CONSTRAINT booking_urgency_check CHECK (urgency IN ('elective', 'urgent', 'emergency')),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CONSTRAINT booking_status_check CHECK (status IN ('booked', 'checked-in', 'in-progress', 'completed', 'cancelled')),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_suite_idx ON theat.booking (suite_id, scheduled_at);
CREATE INDEX IF NOT EXISTS booking_encounter_idx ON theat.booking (encounter_id);

-- WHO checklist stages: sign-in -> time-out -> sign-out, strictly ordered.
CREATE TABLE IF NOT EXISTS theat.checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES theat.booking (id),
  stage text NOT NULL CONSTRAINT checklist_stage_check CHECK (stage IN ('sign-in', 'time-out', 'sign-out')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_stage_unique UNIQUE (booking_id, stage)
);

-- Procedure record (surgeon, anesthesia, notes, times).
CREATE TABLE IF NOT EXISTS theat.record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES theat.booking (id),
  surgeon text NOT NULL DEFAULT '',
  anesthetist text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theat_record_booking_unique UNIQUE (booking_id)
);
