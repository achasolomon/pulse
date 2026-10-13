-- Sprint 37: ICU/HDU bed-flow (EPIC-25, CLIN-001 section 13). Beds reuse the
-- Sprint 27 location hierarchy: a bed is an org.location row with kind='bed'.
-- Additive columns give beds clinical capability + operational state. The flow
-- schema holds occupancy truth (assignments) and level-of-care history.

ALTER TABLE org.location
  ADD COLUMN IF NOT EXISTS level_of_care text
    CONSTRAINT location_loc_check CHECK (level_of_care IS NULL OR level_of_care IN ('ward', 'hdu', 'icu')),
  ADD COLUMN IF NOT EXISTS isolation_capable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS out_of_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS out_of_service_reason text;

-- CLIN-001 13.1: reservation alone is not admission — occupancy is an active
-- assignment row. DB partial uniques make double-booking impossible even for
-- direct SQL: one active assignment per bed and per encounter.
CREATE SCHEMA IF NOT EXISTS flow;

CREATE TABLE IF NOT EXISTS flow.bed_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES org.location (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  status text NOT NULL DEFAULT 'active' CONSTRAINT bed_assignment_status_check CHECK (status IN ('active', 'ended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bed_assignment_ended_check CHECK (status <> 'ended' OR ended_at IS NOT NULL)
);
CREATE UNIQUE INDEX bed_assignment_one_active_bed_idx
  ON flow.bed_assignment (location_id) WHERE status = 'active';
CREATE UNIQUE INDEX bed_assignment_one_active_enc_idx
  ON flow.bed_assignment (encounter_id) WHERE status = 'active';
CREATE INDEX bed_assignment_facility_idx ON flow.bed_assignment (facility_id, status);

-- Level of care: latest active row is current; history is preserved (same
-- principle as acuity: latest prominent without erasing prior values).
CREATE TABLE IF NOT EXISTS flow.level_of_care (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  level text NOT NULL CONSTRAINT level_of_care_level_check CHECK (level IN ('ward', 'hdu', 'icu')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CONSTRAINT level_of_care_status_check CHECK (status IN ('active', 'ended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT level_of_care_ended_check CHECK (status <> 'ended' OR ended_at IS NOT NULL)
);
CREATE UNIQUE INDEX level_of_care_one_active_idx
  ON flow.level_of_care (encounter_id) WHERE status = 'active';
CREATE INDEX level_of_care_encounter_idx ON flow.level_of_care (encounter_id, starts_at DESC);
