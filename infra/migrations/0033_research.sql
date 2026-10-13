-- Sprint 38: research governance (EPIC-25 final slice). BACKLOG-001: cohort/
-- query governance, de-identification/pseudonymization, approvals, export
-- controls, provenance. IAM-001: research is an approved purpose; access uses
-- approved scope + de-identification. The subject_link vault is the only place
-- study pseudonyms meet patient identity.

CREATE SCHEMA IF NOT EXISTS res;

CREATE TABLE IF NOT EXISTS res.study (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CONSTRAINT study_status_check CHECK (status IN ('draft', 'approved', 'closed')),
  approved_by text,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_code_unique UNIQUE (code),
  CONSTRAINT study_approved_check CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

-- Governed cohort queries: immutable versions; criteria is the governed
-- artifact (jsonb), not executable against the warehouse from here.
CREATE TABLE IF NOT EXISTS res.cohort_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES res.study (id),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CONSTRAINT cohort_version_check CHECK (version > 0),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CONSTRAINT cohort_status_check CHECK (status IN ('draft', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_name_version_unique UNIQUE (study_id, name, version)
);

-- Export controls: requested -> approved|denied; approved -> exported;
-- exported -> revoked. patient_ids snapshots the requested membership at
-- request time (provenance). De-identified exports carry pseudonyms only.
CREATE TABLE IF NOT EXISTS res.dataset_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES res.study (id),
  cohort_definition_id uuid NOT NULL REFERENCES res.cohort_definition (id),
  requested_by text NOT NULL,
  patient_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'requested' CONSTRAINT export_status_check CHECK (status IN ('requested', 'approved', 'denied', 'exported', 'revoked')),
  row_count integer,
  deidentified boolean NOT NULL DEFAULT true,
  decision_by text,
  decision_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  exported_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_rows_check CHECK (status <> 'exported' OR row_count IS NOT NULL)
);

-- Re-identification vault: pseudonyms are per-study; generated once and stable
-- across re-exports (ON CONFLICT DO NOTHING at generation time).
CREATE TABLE IF NOT EXISTS res.subject_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES res.study (id),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  pseudonym text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subject_patient_unique UNIQUE (study_id, patient_id),
  CONSTRAINT subject_pseudonym_unique UNIQUE (study_id, pseudonym)
);
