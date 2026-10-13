-- 0024_anatomy
-- Sprint 28: Anatomical Clinical Mapping Engine (ANAT-001 sections 4, 9, 24-30, 44).
-- Plain-SQL, additive only. Semantics (structure/laterality/finding) stay relational
-- and queryable; geometry is JSONB (ANAT-001 section 28). No patient identifiers in
-- object-storage keys (nothing stored here yet).

CREATE SCHEMA IF NOT EXISTS anat;

-- Versioned model package (reference data; published versions immutable, retired
-- versions remain retrievable for historical findings).
CREATE TABLE IF NOT EXISTS anat.anatomy_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor text NOT NULL,
  model_name text NOT NULL,
  version text NOT NULL,
  anatomy_profile text NOT NULL DEFAULT 'adult_general',
  coordinate_system text NOT NULL DEFAULT 'model_space',
  units text NOT NULL DEFAULT 'mm',
  structure_manifest_version text NOT NULL DEFAULT '1',
  licence text NOT NULL DEFAULT '',
  checksum text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT anatomy_model_status_check CHECK (status IN ('draft', 'validation', 'active', 'retired', 'withdrawn')),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anatomy_model_version_unique UNIQUE (model_name, version)
);

-- Semantic structure hierarchy (system/region/structure/substructure/landmark).
CREATE TABLE IF NOT EXISTS anat.anatomy_structure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES anat.anatomy_model (id),
  vendor_structure_key text NOT NULL,
  parent_structure_id uuid REFERENCES anat.anatomy_structure (id),
  level text NOT NULL
    CONSTRAINT anatomy_structure_level_check CHECK (level IN ('system', 'region', 'structure', 'substructure', 'landmark')),
  name text NOT NULL,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anatomy_structure_key_unique UNIQUE (model_id, vendor_structure_key)
);
CREATE INDEX IF NOT EXISTS anatomy_structure_model_idx ON anat.anatomy_structure (model_id);
CREATE INDEX IF NOT EXISTS anatomy_structure_parent_idx ON anat.anatomy_structure (parent_structure_id);

-- Terminology mapping (governance-approved; versioned coding systems).
CREATE TABLE IF NOT EXISTS anat.structure_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id uuid NOT NULL REFERENCES anat.anatomy_structure (id),
  coding_system text NOT NULL,
  code text NOT NULL,
  code_version text NOT NULL DEFAULT '',
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT structure_mapping_unique UNIQUE (structure_id, coding_system, code, code_version)
);
CREATE INDEX IF NOT EXISTS structure_mapping_structure_idx ON anat.structure_mapping (structure_id);

-- Clinical finding: attributed, longitudinal, never destructively deleted.
-- ANATOMY SAFETY RULE: laterality is semantic (never derived from camera/screen side);
-- status machine draft -> signed -> amended / entered_in_error.
CREATE TABLE IF NOT EXISTS anat.finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  anatomy_model_id uuid NOT NULL REFERENCES anat.anatomy_model (id),
  anatomy_structure_id uuid NOT NULL REFERENCES anat.anatomy_structure (id),
  laterality text
    CONSTRAINT finding_laterality_check CHECK (laterality IS NULL OR laterality IN ('left', 'right', 'bilateral', 'midline', 'not_applicable', 'unknown')),
  finding_type text NOT NULL,
  finding_text text NOT NULL DEFAULT '',
  severity text
    CONSTRAINT finding_severity_check CHECK (severity IS NULL OR severity IN ('mild', 'moderate', 'severe')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  author_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT finding_status_check CHECK (status IN ('draft', 'signed', 'amended', 'entered_in_error')),
  version integer NOT NULL DEFAULT 1,
  geometry jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_ref text,
  amends_id uuid REFERENCES anat.finding (id),
  amendment_reason text,
  error_reason text,
  signed_by uuid,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finding_version_positive CHECK (version >= 1),
  CONSTRAINT finding_amend_reason_required CHECK (amends_id IS NULL OR amendment_reason IS NOT NULL),
  CONSTRAINT finding_error_reason_required CHECK (status <> 'entered_in_error' OR error_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS finding_patient_idx ON anat.finding (patient_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS finding_encounter_idx ON anat.finding (encounter_id);
CREATE INDEX IF NOT EXISTS finding_facility_idx ON anat.finding (facility_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS finding_structure_idx ON anat.finding (anatomy_structure_id);
CREATE UNIQUE INDEX IF NOT EXISTS finding_client_ref_uidx
  ON anat.finding (facility_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- Clinical relations (ANAT-001 section 26 "Link clinical resource"). Target types
-- map to existing patient-bearing tables: condition -> clin.entry (problem/diagnosis),
-- observation -> clin.observation, note -> clin.note, document -> docs.document,
-- encounter -> encounter.encounter. No procedure table yet (theatre is schedule-level);
-- procedure links land with the surgical episode slice.
CREATE TABLE IF NOT EXISTS anat.finding_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES anat.finding (id) ON DELETE CASCADE,
  target_type text NOT NULL
    CONSTRAINT finding_link_target_check CHECK (target_type IN ('condition', 'observation', 'note', 'document', 'encounter')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finding_link_unique UNIQUE (finding_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS finding_link_target_idx ON anat.finding_link (target_type, target_id);
