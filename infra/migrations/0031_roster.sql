-- Sprint 36: roster / workforce (EPIC-25). ARCH-001 practitioner
-- assignment/roster; IAM-001 section 46 assignment context (data side only —
-- runtime access narrowing is a later integration); OPS-001 section 45
-- on-call rota with primary/secondary and fatigue controls.

CREATE SCHEMA IF NOT EXISTS ros;

CREATE TABLE IF NOT EXISTS ros.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  display_name text NOT NULL,
  role text NOT NULL CONSTRAINT ros_staff_role_check CHECK (role IN ('doctor', 'nurse', 'midwife', 'pharmacist', 'technician', 'allied_health', 'coordinator')),
  contact text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_facility_idx ON ros.staff (facility_id, active);

-- Shifts double as the on-call rota (kind on_call_primary / on_call_secondary).
-- Overlap + rolling-24h fatigue are service-level assistive guards; the DB
-- keeps the window ordered.
CREATE TABLE IF NOT EXISTS ros.shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES ros.staff (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  kind text NOT NULL CONSTRAINT ros_shift_kind_check CHECK (kind IN ('day', 'evening', 'night', 'on_call_primary', 'on_call_secondary')),
  unit text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CONSTRAINT ros_shift_status_check CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ros_shift_window_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS shift_staff_window_idx ON ros.shift (staff_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS shift_facility_idx ON ros.shift (facility_id, starts_at, ends_at);

-- IAM-001 section 46: ward assignment = default patient list; cross_cover adds
-- scoped access; on_call may broaden for a defined period; ending an assignment
-- removes the default relationship.
CREATE TABLE IF NOT EXISTS ros.assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES ros.staff (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  kind text NOT NULL CONSTRAINT ros_assignment_kind_check CHECK (kind IN ('primary', 'cross_cover', 'on_call')),
  unit text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active' CONSTRAINT ros_assignment_status_check CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_staff_idx ON ros.assignment (staff_id, status);
CREATE INDEX IF NOT EXISTS assignment_unit_idx ON ros.assignment (facility_id, unit, status);
