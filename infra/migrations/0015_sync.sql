-- 0015_sync
-- Sprint 19: edge sync foundation (ARCH-001 section 13, DB-001 sections 90-91).
-- Additive only. Feed reads the outbox; apply dedupes through the inbox.

-- Consumer watermarks per edge node / device.
CREATE TABLE IF NOT EXISTS integration.sync_state (
  consumer_id text PRIMARY KEY,
  last_created_at timestamptz,
  last_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Conflict log: anything that cannot be applied cleanly waits for review.
CREATE TABLE IF NOT EXISTS integration.sync_conflict (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text NOT NULL,
  aggregate_id text NOT NULL DEFAULT '',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CONSTRAINT sync_conflict_status_check CHECK (status IN ('open', 'resolved')),
  resolution text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_conflict_status_idx ON integration.sync_conflict (status, created_at);
