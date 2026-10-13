-- Sprint 32: EPIC-23 close — alert rules/instances + backup/drill evidence
-- (OPS-001 sections 43-44, 62-68; F23.1/F23.2/F23.3). Rules are seeded with
-- runbook links (every page-worthy alert has a runbook).

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.alert_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('error_rate', 'backup_staleness_minutes')),
  comparator text NOT NULL CHECK (comparator IN ('>', '>=')),
  threshold numeric NOT NULL,
  window_minutes integer NOT NULL DEFAULT 15,
  severity text NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  owner text NOT NULL,
  runbook text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES ops.alert_rule (id),
  state text NOT NULL CHECK (state IN ('firing', 'resolved')),
  value numeric NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_rule_state_idx ON ops.alert (rule_id, state, started_at DESC);

CREATE TABLE ops.backup_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('full', 'wal', 'restore_drill')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rpo_target_minutes integer,
  rto_target_seconds integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX backup_run_kind_idx ON ops.backup_run (kind, status, started_at DESC);

INSERT INTO ops.alert_rule (id, name, description, metric, comparator, threshold, window_minutes, severity, owner, runbook) VALUES
  ('00000000-0000-4000-8000-00000000b001', 'error_rate_p2',
   'HTTP 5xx rate at or above 5% of requests (SLI from pulse_http_requests_total)',
   'error_rate', '>=', 0.05, 15, 'P2', 'sre-on-call',
   'docs/runbooks/alerting.md#error-rate'),
  ('00000000-0000-4000-8000-00000000b002', 'backup_staleness_p2',
   'No successful full backup inside the declared RPO window (OPS-001 63/67)',
   'backup_staleness_minutes', '>', 1500, 15, 'P2', 'sre-on-call',
   'docs/runbooks/alerting.md#backup-staleness');
