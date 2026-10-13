-- Sprint 27: department/location hierarchy (F02.2; ARCH-001 §6, DB-001 §9–§10).
-- Additive only: existing department rows keep working; parent is optional.

ALTER TABLE org.department
  ADD COLUMN IF NOT EXISTS parent_department_id uuid
    REFERENCES org.department (id);

CREATE INDEX IF NOT EXISTS department_parent_idx
  ON org.department (parent_department_id)
  WHERE parent_department_id IS NOT NULL;

-- Unit: sub-department grouping (ward, service line) within a facility.
CREATE TABLE IF NOT EXISTS org.unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_facility_code_unique UNIQUE (facility_id, code)
);
CREATE INDEX IF NOT EXISTS unit_facility_idx ON org.unit (facility_id);

-- Location: concrete place (bed, room, theatre, imaging suite) within a unit.
CREATE TABLE IF NOT EXISTS org.location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES org.unit (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  code text NOT NULL,
  kind text NOT NULL
    CONSTRAINT location_kind_check CHECK (kind IN ('bed', 'room', 'theatre', 'clinic', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_unit_code_unique UNIQUE (unit_id, code)
);
CREATE INDEX IF NOT EXISTS location_unit_idx ON org.location (unit_id);
CREATE INDEX IF NOT EXISTS location_facility_idx ON org.location (facility_id);
