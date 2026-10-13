-- 0002_org_iam
-- Sprint 03: organization hierarchy + workforce membership (PULSE-DB-001 sections 9-10, IAM-001 sections 5-7).
-- Plain-SQL, additive only. All PKs opaque UUIDs. No PHI in these tables.

CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS iam;

-- Organization (hospital group / legal entity root for tenancy)
CREATE TABLE IF NOT EXISTS org.organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_code_unique UNIQUE (code)
);

-- Facility (hospital / clinic operating unit; tenant scope boundary)
CREATE TABLE IF NOT EXISTS org.facility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES org.organization (id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_org_code_unique UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS facility_org_idx ON org.facility (organization_id);

-- Department (service unit within a facility)
CREATE TABLE IF NOT EXISTS org.department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT department_facility_code_unique UNIQUE (facility_id, code)
);
CREATE INDEX IF NOT EXISTS department_facility_idx ON org.department (facility_id);

-- Workforce membership: person x facility scoped roles/privileges (IAM-001 section 5).
-- Roles are coarse; privileges are fine-grained "resource:action" strings.
-- Service accounts have no human person_id (nullable with account name instead).
CREATE TABLE IF NOT EXISTS iam.membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid,
  account_name text,
  organization_id uuid NOT NULL REFERENCES org.organization (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  roles text[] NOT NULL DEFAULT '{}',
  privileges text[] NOT NULL DEFAULT '{}',
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_identity_present CHECK (
    person_id IS NOT NULL OR account_name IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS membership_person_facility_idx
  ON iam.membership (person_id, facility_id);
CREATE INDEX IF NOT EXISTS membership_facility_idx
  ON iam.membership (facility_id);
