-- 0021_staff_auth
-- Sprint 25: staff authentication (IAM-001 sections 5/8, EPIC-03 F03.1).
-- Additive only. Workforce credentials are scrypt hashes; sessions are hashed
-- opaque tokens. Demo-header auth is a runtime flag, not a schema concern.

-- Staff login credentials (one login per person; service accounts use account_name).
CREATE TABLE IF NOT EXISTS iam.credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid,
  account_name text,
  login_id text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CONSTRAINT cred_status_check CHECK (status IN ('active', 'locked', 'disabled')),
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credential_identity_present CHECK (person_id IS NOT NULL OR account_name IS NOT NULL),
  CONSTRAINT credential_login_unique UNIQUE (login_id)
);

-- Staff sessions: only the hash is stored.
CREATE TABLE IF NOT EXISTS iam.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES iam.credential (id),
  person_id uuid,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS iam_session_token_idx ON iam.session (token_hash);

-- SSO identity links (federation adapter lands later; the seam is the mapping).
CREATE TABLE IF NOT EXISTS iam.identity_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  provider text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_link_unique UNIQUE (provider, subject)
);
