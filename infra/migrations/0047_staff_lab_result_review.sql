-- Manual result provenance; final reports cannot be silently rewritten.
ALTER TABLE lab.result ADD COLUMN recorded_by uuid;
ALTER TABLE lab.result ADD COLUMN effective_at timestamptz;
ALTER TABLE lab.result ADD COLUMN source text;
CREATE FUNCTION lab.protect_result_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT status INTO state FROM lab.lab_order WHERE id=NEW.order_id FOR UPDATE;
  IF state='verified' OR (TG_OP='UPDATE' AND OLD.recorded_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Result revisions are immutable; a governed correction is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_result_revision BEFORE INSERT OR UPDATE ON lab.result
FOR EACH ROW EXECUTE FUNCTION lab.protect_result_revision();
