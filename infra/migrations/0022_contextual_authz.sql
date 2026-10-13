-- Sprint 26: contextual authorization + break-glass enforcement (F03.4/F03.5).
-- IAM-001 §17/§18/§31. Additive only.

-- Department scope on membership (F03.4 attribute plumbing; F02.2 hierarchy lands later).
ALTER TABLE iam.membership ADD COLUMN IF NOT EXISTS department_id uuid;

-- Care assignment registry: clinical domains remain authoritative for care
-- truth; IAM consumes assignments for contextual chart-access narrowing (§18).
CREATE TABLE IF NOT EXISTS iam.care_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  person_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  kind text NOT NULL,
  encounter_id uuid,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_assignment_patient_person_idx
  ON iam.care_assignment (patient_id, person_id, facility_id);

-- Break-glass grants (§31): reasoned, time-limited, scoped, reviewable.
CREATE TABLE IF NOT EXISTS iam.break_glass_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  patient_id uuid,
  resource_type text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  review_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS break_glass_person_recent_idx
  ON iam.break_glass_grant (person_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS break_glass_expiry_idx
  ON iam.break_glass_grant (expires_at) WHERE revoked_at IS NULL;
