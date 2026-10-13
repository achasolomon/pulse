-- 0016_benefits
-- Sprint 20: benefit engine (CR-001 Phase 2a, ADR-007).
-- Additive only. Deductible applications link to their charge: re-applying the
-- same charge never double-counts.

-- Plan benefit rules, versioned by effective date (change = new row).
CREATE TABLE IF NOT EXISTS ins.plan_benefit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_code text NOT NULL,
  plan text NOT NULL,
  deductible_annual numeric NOT NULL DEFAULT 0 CONSTRAINT benefit_deduct_nonneg CHECK (deductible_annual >= 0),
  copay_amount numeric NOT NULL DEFAULT 0 CONSTRAINT benefit_copay_nonneg CHECK (copay_amount >= 0),
  coinsurance_pct numeric NOT NULL DEFAULT 0 CONSTRAINT benefit_coins_range CHECK (coinsurance_pct >= 0 AND coinsurance_pct <= 100),
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS benefit_lookup_idx ON ins.plan_benefit (payer_code, plan, effective_from DESC);

-- Deductible consumption ledger (append-only, one row per charge application).
CREATE TABLE IF NOT EXISTS ins.deductible_use (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_code text NOT NULL,
  plan text NOT NULL,
  member_id text NOT NULL,
  year integer NOT NULL,
  charge_id uuid NOT NULL REFERENCES rev.charge (id),
  amount numeric NOT NULL CONSTRAINT ded_use_positive CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ded_charge_unique UNIQUE (charge_id)
);
CREATE INDEX IF NOT EXISTS ded_member_year_idx ON ins.deductible_use (payer_code, plan, member_id, year);
