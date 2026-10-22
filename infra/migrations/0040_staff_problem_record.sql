-- Preserve the original entry while attributing subsequent clinical resolution.
ALTER TABLE clin.entry
  ADD COLUMN recorded_by uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN resolved_by uuid,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolution_reason text,
  ADD COLUMN resolution_encounter_id uuid REFERENCES encounter.encounter(id);
ALTER TABLE clin.entry ADD CONSTRAINT entry_resolution_attribution CHECK (
  (resolved_by IS NULL AND resolved_at IS NULL AND resolution_reason IS NULL AND resolution_encounter_id IS NULL)
  OR (status='resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND length(btrim(resolution_reason)) >= 3 AND resolution_encounter_id IS NOT NULL)
);
