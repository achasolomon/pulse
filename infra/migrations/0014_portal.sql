-- 0014_portal
-- Sprint 16: patient portal accounts, sessions, proxy grants (EPIC-19).
-- Additive only. Patient credentials are scrypt hashes; sessions are hashed opaque tokens.

CREATE SCHEMA IF NOT EXISTS portal;

-- Patient-held login accounts (separate from workforce IAM by design).
CREATE TABLE IF NOT EXISTS portal.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient.patient (id),
  login_id text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CONSTRAINT portal_acct_status_check CHECK (status IN ('active', 'locked', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_login_unique UNIQUE (login_id)
);
CREATE INDEX IF NOT EXISTS portal_acct_patient_idx ON portal.account (patient_id);

-- Opaque sessions: only the hash is stored; plaintext lives with the holder.
CREATE TABLE IF NOT EXISTS portal.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES portal.account (id),
  token_hash text NOT NULL,
  acting_patient_id uuid NOT NULL REFERENCES patient.patient (id),
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_session_token_idx ON portal.session (token_hash);

-- Proxy grants: one patient account acts for a dependent within scopes.
CREATE TABLE IF NOT EXISTS portal.proxy_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependent_patient_id uuid NOT NULL REFERENCES patient.patient (id),
  proxy_account_id uuid NOT NULL REFERENCES portal.account (id),
  relationship text NOT NULL DEFAULT '',
  scopes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proxy_pair_unique UNIQUE (dependent_patient_id, proxy_account_id)
);
