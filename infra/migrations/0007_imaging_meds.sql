-- 0007_imaging_meds
-- Sprint 08: imaging + medication (IMG-001, MED-001, DB-001 sections 25-30).
-- Additive only. Pixels stay in PACS (references only). eMAR administrations append-only.

CREATE SCHEMA IF NOT EXISTS img;
CREATE SCHEMA IF NOT EXISTS med;

-- Imaging order (RIS-like workflow; integrates with external RIS/PACS via refs).
CREATE TABLE IF NOT EXISTS img.img_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  procedure_code text NOT NULL,
  body_region text NOT NULL,
  laterality text CONSTRAINT img_laterality_check CHECK (laterality IS NULL OR laterality IN ('left', 'right', 'bilateral', 'na')),
  indication text NOT NULL DEFAULT '',
  urgency text NOT NULL DEFAULT 'routine' CONSTRAINT img_urgency_check CHECK (urgency IN ('stat', 'urgent', 'routine')),
  status text NOT NULL DEFAULT 'ordered' CONSTRAINT img_status_check CHECK (status IN ('ordered', 'scheduled', 'protocolled', 'acquired', 'reported', 'final', 'cancelled')),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS img_order_patient_idx ON img.img_order (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS img_order_worklist_idx ON img.img_order (status, created_at)
  WHERE status IN ('ordered', 'scheduled', 'protocolled', 'acquired', 'reported');

-- Study linkage: diagnostic pixels live in PACS/VNA; Pulse keeps identifiers + ref.
CREATE TABLE IF NOT EXISTS img.study (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES img.img_order (id),
  study_uid text NOT NULL,
  accession text NOT NULL DEFAULT '',
  modality text NOT NULL DEFAULT '',
  pacs_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_uid_unique UNIQUE (study_uid)
);

-- Versioned radiology reports (amendments are new versions).
CREATE TABLE IF NOT EXISTS img.report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES img.img_order (id),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CONSTRAINT img_report_status_check CHECK (status IN ('draft', 'final')),
  version integer NOT NULL DEFAULT 1,
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT img_report_version_positive CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS img_report_order_idx ON img.img_order (id);

-- Canonical medication catalogue (brand/packaging separated; versioned).
CREATE TABLE IF NOT EXISTS med.medication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  dose_form text NOT NULL DEFAULT '',
  strength text NOT NULL DEFAULT '',
  route text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS med_code_version_uidx ON med.medication (code, version);

-- Prescription lifecycle.
CREATE TABLE IF NOT EXISTS med.request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  medication_id uuid NOT NULL REFERENCES med.medication (id),
  dose text NOT NULL,
  dose_unit text NOT NULL DEFAULT '',
  route text NOT NULL DEFAULT '',
  frequency text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'prescribed' CONSTRAINT med_req_status_check CHECK (status IN ('prescribed', 'verified', 'dispensed', 'completed', 'held', 'cancelled')),
  hold_reason text,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS med_req_patient_idx ON med.request (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS med_req_worklist_idx ON med.request (status, created_at)
  WHERE status IN ('prescribed', 'verified', 'dispensed');

-- Dispense events (batch traceable for R3 linkage).
CREATE TABLE IF NOT EXISTS med.dispense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES med.request (id),
  quantity text NOT NULL,
  batch text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- eMAR administrations: append-only, every dose accounted for.
CREATE TABLE IF NOT EXISTS med.administration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES med.request (id),
  dose_given text NOT NULL,
  outcome text NOT NULL CONSTRAINT med_admin_outcome_check CHECK (outcome IN ('given', 'not-given', 'held')),
  reason text NOT NULL DEFAULT '',
  given_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS med_admin_req_idx ON med.administration (request_id, given_at);
