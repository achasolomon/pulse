-- 0008_inventory_workflow_docs
-- Sprint 09: inventory + workflow + documents (INV-001, ARCH-001 sections 17/22/23).
-- Additive only. Ledger is append-only: no UPDATE/DELETE path in app.

CREATE SCHEMA IF NOT EXISTS inv;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS docs;

-- Item catalogue with base unit + conversion map (JSON, explicit).
CREATE TABLE IF NOT EXISTS inv.item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  base_unit text NOT NULL,
  conversions jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_batch boolean NOT NULL DEFAULT false,
  requires_expiry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_item_code_unique UNIQUE (code)
);

-- Storage locations (facility-scoped hierarchy via parent).
CREATE TABLE IF NOT EXISTS inv.location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  parent_id uuid REFERENCES inv.location (id),
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_location_code_unique UNIQUE (facility_id, code)
);

-- Batches/lots with expiry (batch-specific).
CREATE TABLE IF NOT EXISTS inv.lot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inv.item (id),
  lot_number text NOT NULL,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_lot_unique UNIQUE (item_id, lot_number)
);

-- Immutable stock ledger: every movement is a row (receive/issue/transfer/count-adjust).
CREATE TABLE IF NOT EXISTS inv.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inv.item (id),
  location_id uuid NOT NULL REFERENCES inv.location (id),
  lot_id uuid REFERENCES inv.lot (id),
  quantity_base numeric NOT NULL,
  movement text NOT NULL CONSTRAINT inv_movement_check CHECK (movement IN ('receive', 'issue', 'transfer-in', 'transfer-out', 'adjust')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_item_loc_idx ON inv.ledger (item_id, location_id);
CREATE INDEX IF NOT EXISTS ledger_lot_idx ON inv.ledger (lot_id);

-- Procurement cycle: requisition -> purchase order -> receipt (receipt posts ledger).
CREATE TABLE IF NOT EXISTS inv.requisition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  item_id uuid NOT NULL REFERENCES inv.item (id),
  quantity_base numeric NOT NULL CONSTRAINT req_qty_positive CHECK (quantity_base > 0),
  status text NOT NULL DEFAULT 'open' CONSTRAINT req_status_check CHECK (status IN ('open', 'ordered', 'received', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv.purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES inv.requisition (id),
  supplier text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CONSTRAINT po_status_check CHECK (status IN ('sent', 'received', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Durable tasks with escalation state.
CREATE TABLE IF NOT EXISTS workflow.task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  patient_id uuid REFERENCES patient.patient (id),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CONSTRAINT task_status_check CHECK (status IN ('open', 'done', 'escalated', 'cancelled')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_facility_idx ON workflow.task (facility_id, status, due_at);

-- Notification records (delivery adapters later; outbox carries the event).
CREATE TABLE IF NOT EXISTS workflow.notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CONSTRAINT notif_channel_check CHECK (channel IN ('in-app', 'sms', 'email')),
  recipient text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CONSTRAINT notif_status_check CHECK (status IN ('queued', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Document metadata (blobs in object storage; Postgres keeps the pointer).
CREATE TABLE IF NOT EXISTS docs.document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patient.patient (id),
  encounter_id uuid REFERENCES encounter.encounter (id),
  name text NOT NULL,
  mime text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS docs_patient_idx ON docs.document (patient_id, created_at DESC);
