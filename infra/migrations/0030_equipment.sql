-- Sprint 35: equipment/asset domain (EPIC-25, INV-001 section 40).
-- Commissioning handoff from procurement: the asset keeps its PO link; serial
-- identity is unique. Spare parts stay inventory items (inv.*) — this schema
-- manages durable assets, their downtime and their maintenance lifecycle.

CREATE SCHEMA IF NOT EXISTS eqp;

CREATE TABLE IF NOT EXISTS eqp.asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  manufacturer text NOT NULL,
  model text NOT NULL,
  serial text NOT NULL,
  purchase_order_id uuid REFERENCES inv.purchase_order (id),
  status text NOT NULL DEFAULT 'in_service' CONSTRAINT eqp_asset_status_check CHECK (status IN ('in_service', 'out_of_service', 'retired')),
  commissioned_at timestamptz NOT NULL DEFAULT now(),
  out_of_service_reason text,
  out_of_service_since timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eqp_asset_serial_unique UNIQUE (serial),
  CONSTRAINT eqp_asset_retired_check CHECK (status <> 'retired' OR retired_at IS NOT NULL),
  CONSTRAINT eqp_asset_oos_check CHECK (status <> 'out_of_service' OR (out_of_service_reason IS NOT NULL AND out_of_service_since IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS asset_facility_idx ON eqp.asset (facility_id, status);

-- Preventive maintenance / calibration / corrective work. interval_days drives
-- recurrence: completing a recurring task schedules the next occurrence.
-- Overdue is derived (scheduled + due_at in the past), never stored — the
-- clock is authoritative, not a stale flag.
CREATE TABLE IF NOT EXISTS eqp.maintenance_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES eqp.asset (id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT eqp_task_kind_check CHECK (kind IN ('preventive', 'calibration', 'corrective')),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CONSTRAINT eqp_task_status_check CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  interval_days integer,
  completed_at timestamptz,
  completed_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eqp_task_completed_check CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT eqp_task_interval_check CHECK (interval_days IS NULL OR interval_days > 0)
);
CREATE INDEX IF NOT EXISTS task_asset_due_idx ON eqp.maintenance_task (asset_id, status, due_at);
