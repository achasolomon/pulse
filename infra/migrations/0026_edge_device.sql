-- Sprint 30: edge device runtime (EPIC-21 / F21.1).
-- Enrolled edge gateways: one-time opaque token, facility binding,
-- approved local-data capability subset, disconnect-window tracking.

CREATE TABLE integration.device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES org.facility (id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'edge-gateway'
    CHECK (kind IN ('edge-gateway', 'branch-server', 'kiosk')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'decommissioned')),
  token_hash text NOT NULL UNIQUE,
  capabilities text[] NOT NULL,
  max_disconnected_hours integer NOT NULL DEFAULT 72,
  last_seen_at timestamptz,
  last_heartbeat jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  decommissioned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_facility_name_unique UNIQUE (facility_id, name),
  CONSTRAINT device_capabilities_nonempty CHECK (cardinality(capabilities) > 0)
);

CREATE INDEX device_facility_status_idx ON integration.device (facility_id, status);

CREATE TABLE integration.device_heartbeat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES integration.device (id),
  pending_out integer NOT NULL DEFAULT 0,
  pending_in integer NOT NULL DEFAULT 0,
  last_sync_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_heartbeat_device_idx
  ON integration.device_heartbeat (device_id, recorded_at DESC);
