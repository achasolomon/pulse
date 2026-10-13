-- 0018_autocharge
-- Sprint 22: automatic charge generation (CR-001 Phase 2b billing automation).
-- Additive only. source_event_id makes projection idempotent per event.

CREATE TABLE IF NOT EXISTS rev.billing_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  service_code text,
  code_field text,
  quantity numeric NOT NULL DEFAULT 1 CONSTRAINT bill_rule_qty_positive CHECK (quantity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_rule_unique UNIQUE (event_type, service_code)
);

ALTER TABLE rev.charge ADD COLUMN IF NOT EXISTS source_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS charge_source_event_uidx ON rev.charge (source_event_id);
