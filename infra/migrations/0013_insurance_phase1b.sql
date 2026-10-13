-- 0013_insurance_phase1b
-- Sprint 14: CR-001 Phase 1b (allocation, eligibility, preauth, claim depth).
-- Additive only: new tables + nullable columns. No alters to existing columns.

-- Responsibility splits: each share of a charge owned by exactly one party.
CREATE TABLE IF NOT EXISTS rev.allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES rev.charge (id),
  party_type text NOT NULL CONSTRAINT alloc_party_check CHECK (party_type IN ('patient', 'payer', 'guarantor')),
  party_ref text NOT NULL,
  share_pct numeric NOT NULL CONSTRAINT alloc_pct_range CHECK (share_pct >= 0 AND share_pct <= 100),
  amount numeric NOT NULL CONSTRAINT alloc_amount_nonneg CHECK (amount >= 0),
  tariff_id uuid REFERENCES ins.tariff_line (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alloc_charge_idx ON rev.allocation (charge_id);

-- Claim lines sourced from charges (amounts frozen at assembly).
CREATE TABLE IF NOT EXISTS rev.claim_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES rev.claim (id),
  charge_id uuid NOT NULL REFERENCES rev.charge (id),
  amount numeric NOT NULL CONSTRAINT claim_line_nonneg CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_charge_unique UNIQUE (claim_id, charge_id)
);

-- Claim submissions: every send (incl. resubmission after appeal) is a new version.
CREATE TABLE IF NOT EXISTS rev.claim_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES rev.claim (id),
  version integer NOT NULL,
  payer_claim_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_sub_version_positive CHECK (version >= 1),
  CONSTRAINT claim_sub_unique UNIQUE (claim_id, version)
);

-- Eligibility verification evidence.
CREATE TABLE IF NOT EXISTS ins.eligibility_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id uuid NOT NULL REFERENCES rev.coverage (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  method text NOT NULL CONSTRAINT elig_method_check CHECK (method IN ('manual', 'payer-query')),
  evidence text NOT NULL DEFAULT '',
  verified_by uuid,
  result text NOT NULL CONSTRAINT elig_result_check CHECK (result IN ('eligible', 'ineligible', 'partial')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS elig_coverage_idx ON ins.eligibility_check (coverage_id, created_at DESC);

-- Preauthorization cases with line items and bounded decisions.
CREATE TABLE IF NOT EXISTS ins.preauth_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id uuid NOT NULL REFERENCES rev.coverage (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'requested' CONSTRAINT preauth_status_check CHECK (status IN ('requested', 'docs-requested', 'approved', 'denied', 'expired', 'cancelled')),
  decision_note text NOT NULL DEFAULT '',
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preauth_encounter_idx ON ins.preauth_case (encounter_id, status);

-- Coverage snapshot on the visit + guarantor on the patient (both nullable: cash path null).
ALTER TABLE encounter.encounter ADD COLUMN IF NOT EXISTS coverage_id uuid REFERENCES rev.coverage (id);
ALTER TABLE patient.patient ADD COLUMN IF NOT EXISTS guarantor_name text;
ALTER TABLE patient.patient ADD COLUMN IF NOT EXISTS guarantor_contact text;
