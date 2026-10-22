ALTER TABLE clin.note ADD COLUMN IF NOT EXISTS note_type text NOT NULL DEFAULT 'clinical' CHECK(note_type IN ('clinical','consultation','nursing'));
ALTER TABLE clin.note ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE clin.note ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clin.note_addendum ADD COLUMN IF NOT EXISTS author_id uuid;
CREATE INDEX IF NOT EXISTS note_author_draft_idx ON clin.note(author_id,patient_id,updated_at DESC) WHERE status='draft';
CREATE OR REPLACE FUNCTION clin.protect_signed_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='signed' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Signed notes are immutable; append an addendum' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS note_signed_immutable ON clin.note;
CREATE TRIGGER note_signed_immutable BEFORE UPDATE ON clin.note FOR EACH ROW EXECUTE FUNCTION clin.protect_signed_note();
