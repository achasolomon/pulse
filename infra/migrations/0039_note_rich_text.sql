-- Formatting accompanies the canonical plain-text narrative. The existing
-- signed-note trigger also protects this column from modification after signing.
ALTER TABLE clin.note ADD COLUMN IF NOT EXISTS rich_text jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clin.note ADD CONSTRAINT note_rich_text_object CHECK (jsonb_typeof(rich_text)='object');
