ALTER TABLE iam.credential ADD COLUMN IF NOT EXISTS recovery_email text;
ALTER TABLE iam.credential ADD COLUMN IF NOT EXISTS recovery_email_verified_at timestamptz;
CREATE TABLE IF NOT EXISTS iam.recovery_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES iam.credential(id),
  purpose text NOT NULL CHECK (purpose IN ('password_reset','verify_email')),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  mail_token_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
