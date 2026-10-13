-- 0009_revenue
-- Sprint 10: revenue cycle (REV-001, DB-001 sections 37-40).
-- Additive only. Money never rewrites clinical state: charges/invoices/payments
-- reference care events; cancellations/voids/refunds are reasoned rows, not deletes.

CREATE SCHEMA IF NOT EXISTS rev;

-- Billable service catalogue (tariff price pinned at charge time).
CREATE TABLE IF NOT EXISTS rev.service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  default_price numeric NOT NULL CONSTRAINT svc_price_nonneg CHECK (default_price >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT svc_code_unique UNIQUE (code)
);

-- Charge capture: projection of a clinical event (never the event itself).
CREATE TABLE IF NOT EXISTS rev.charge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  service_code text NOT NULL,
  quantity numeric NOT NULL CONSTRAINT charge_qty_positive CHECK (quantity > 0),
  unit_price numeric NOT NULL CONSTRAINT charge_price_nonneg CHECK (unit_price >= 0),
  status text NOT NULL DEFAULT 'captured' CONSTRAINT charge_status_check CHECK (status IN ('captured', 'billed', 'cancelled')),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_patient_idx ON rev.charge (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS charge_encounter_idx ON rev.charge (encounter_id);

-- Invoice with derived totals (lines reference charges).
CREATE TABLE IF NOT EXISTS rev.invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  status text NOT NULL DEFAULT 'draft' CONSTRAINT invoice_status_check CHECK (status IN ('draft', 'final', 'paid', 'partial', 'void')),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rev.invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES rev.invoice (id),
  charge_id uuid NOT NULL REFERENCES rev.charge (id),
  amount numeric NOT NULL CONSTRAINT line_amount_nonneg CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_charge_unique UNIQUE (invoice_id, charge_id)
);

-- Payments allocated to invoices; refunds/adjustments are separate rows.
CREATE TABLE IF NOT EXISTS rev.payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES rev.invoice (id),
  amount numeric NOT NULL CONSTRAINT payment_amount_positive CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed' CONSTRAINT payment_status_check CHECK (status IN ('completed', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rev.adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES rev.invoice (id),
  amount numeric NOT NULL CONSTRAINT adj_amount_positive CHECK (amount > 0),
  kind text NOT NULL CONSTRAINT adj_kind_check CHECK (kind IN ('refund', 'write-off', 'correction')),
  reason text NOT NULL CONSTRAINT adj_reason_present CHECK (reason <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Coverage: payer/plan membership per patient (time-bound).
CREATE TABLE IF NOT EXISTS rev.coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  payer text NOT NULL,
  plan text NOT NULL,
  member_id text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coverage_patient_idx ON rev.coverage (patient_id, effective_from DESC);

-- Authorization against a coverage for an encounter.
CREATE TABLE IF NOT EXISTS rev.authorization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id uuid NOT NULL REFERENCES rev.coverage (id),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  approved_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CONSTRAINT auth_status_check CHECK (status IN ('pending', 'approved', 'denied')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Claim lifecycle per invoice.
CREATE TABLE IF NOT EXISTS rev.claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES rev.invoice (id),
  payer text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CONSTRAINT claim_status_check CHECK (status IN ('draft', 'submitted', 'acknowledged', 'paid', 'denied', 'appealed')),
  denial_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_invoice_idx ON rev.claim (invoice_id, created_at DESC);
