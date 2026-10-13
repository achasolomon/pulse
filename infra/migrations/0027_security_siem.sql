-- Sprint 31: EPIC-22 close — SIEM security event stream + pentest findings triage
-- (SEC-001 section 60/61/86, F22.1). SOC collectors consume security.event via
-- the cursor feed; findings carry triage state for penetration-test intake.

CREATE SCHEMA IF NOT EXISTS security;

CREATE TABLE security.event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL
    CHECK (category IN ('authn', 'authz', 'break_glass', 'admin', 'integration', 'device', 'privacy', 'abuse')),
  action text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  actor_type text NOT NULL DEFAULT 'unknown'
    CHECK (actor_type IN ('person', 'partner', 'device', 'system', 'unknown')),
  actor_id text,
  facility_id uuid,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_event_occurred_idx ON security.event (occurred_at DESC);
CREATE INDEX security_event_severity_idx ON security.event (severity, occurred_at DESC);
CREATE INDEX security_event_category_idx ON security.event (category, occurred_at DESC);
CREATE INDEX security_event_actor_idx ON security.event (actor_id, occurred_at DESC);

CREATE TABLE security.finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  severity text NOT NULL
    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'triaged', 'mitigated', 'accepted')),
  vector text,
  component text NOT NULL,
  evidence text,
  owner text,
  remediation text,
  found_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  triaged_by text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX finding_status_idx ON security.finding (status, severity, found_at DESC);
