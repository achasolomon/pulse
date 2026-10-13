-- 0017_emergency
-- Sprint 21: emergency care slice (R6 start, CLIN-001 emergency paths).
-- Additive only. Acuity scores are append-only; re-scores never overwrite.

CREATE SCHEMA IF NOT EXISTS emg;

-- Acuity assessment per emergency encounter (1 = resuscitation .. 5 = non-urgent).
CREATE TABLE IF NOT EXISTS emg.acuity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter.encounter (id),
  level integer NOT NULL CONSTRAINT acuity_range CHECK (level >= 1 AND level <= 5),
  discriminator text NOT NULL DEFAULT '',
  override_reason text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acuity_encounter_idx ON emg.acuity (encounter_id, created_at DESC);
