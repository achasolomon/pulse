-- 0010_consent_referral
-- Sprint 11: consent + referral exchange (PRIV-001, REF-001, DB-001 sections 35-36/41).
-- Additive only. Sent package versions immutable; withdrawal never rewrites history.

CREATE SCHEMA IF NOT EXISTS consent;
CREATE SCHEMA IF NOT EXISTS referral;

-- Consent artefacts: who may disclose what to whom, for which purpose, in which window.
CREATE TABLE IF NOT EXISTS consent.consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  grantee text NOT NULL,
  purpose text NOT NULL CONSTRAINT consent_purpose_check CHECK (purpose IN ('treatment', 'referral', 'billing', 'research', 'operations')),
  scope text NOT NULL DEFAULT 'clinical-summary',
  status text NOT NULL DEFAULT 'granted' CONSTRAINT consent_status_check CHECK (status IN ('granted', 'withdrawn', 'expired')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  withdraw_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_patient_idx ON consent.consent (patient_id, status, valid_from DESC);

-- Disclosure log: every cross-facility package send recorded (minimum-necessary manifest).
CREATE TABLE IF NOT EXISTS consent.disclosure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  grantee text NOT NULL,
  purpose text NOT NULL,
  case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disclosure_patient_idx ON consent.disclosure (patient_id, created_at DESC);

-- Referral case (RTX): governed exchange, each org keeps its own legal record.
CREATE TABLE IF NOT EXISTS referral.case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  sending_facility_id uuid NOT NULL REFERENCES org.facility (id),
  receiving_facility_id uuid REFERENCES org.facility (id),
  type text NOT NULL DEFAULT 'routine' CONSTRAINT ref_type_check CHECK (type IN ('routine', 'urgent', 'emergency', 'transfer')),
  urgency text NOT NULL DEFAULT 'routine' CONSTRAINT ref_urgency_check CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  clinical_question text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CONSTRAINT ref_status_check CHECK (status IN ('draft', 'submitted', 'acknowledged', 'info-requested', 'accepted', 'declined', 'scheduled', 'in-transit', 'arrived', 'closed', 'cancelled', 'expired')),
  package_version integer NOT NULL DEFAULT 1,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ref_sending_idx ON referral.case (sending_facility_id, status);
CREATE INDEX IF NOT EXISTS ref_receiving_idx ON referral.case (receiving_facility_id, status);
CREATE INDEX IF NOT EXISTS ref_patient_idx ON referral.case (patient_id, created_at DESC);

-- Immutable submission package versions (one row per send).
CREATE TABLE IF NOT EXISTS referral.package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES referral.case (id),
  version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ref_package_unique UNIQUE (case_id, version)
);

-- Messaging thread on a case (clarifications before travel).
CREATE TABLE IF NOT EXISTS referral.message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES referral.case (id),
  author_id uuid,
  body text NOT NULL CONSTRAINT ref_msg_present CHECK (body <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ref_msg_case_idx ON referral.message (case_id, created_at);
