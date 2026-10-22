CREATE TABLE img.procedure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,name text NOT NULL,
  modality text NOT NULL,body_region text NOT NULL,
  laterality_policy text NOT NULL CHECK(laterality_policy IN ('required','optional','na')),
  instructions text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(code,version),UNIQUE(id,version)
);
CREATE TABLE img.facility_procedure (
  facility_id uuid NOT NULL REFERENCES org.facility(id),procedure_id uuid NOT NULL REFERENCES img.procedure(id),
  active boolean NOT NULL DEFAULT true,PRIMARY KEY(facility_id,procedure_id)
);
ALTER TABLE img.img_order ADD COLUMN procedure_id uuid REFERENCES img.procedure(id);
ALTER TABLE img.img_order ADD COLUMN procedure_version integer;
ALTER TABLE img.img_order ADD COLUMN ordered_by uuid;
ALTER TABLE img.img_order ADD COLUMN cancelled_by uuid;
ALTER TABLE img.img_order ADD COLUMN cancelled_at timestamptz;
ALTER TABLE img.img_order ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE img.img_order ADD COLUMN safety_context text NOT NULL DEFAULT '';
ALTER TABLE img.img_order ADD CONSTRAINT img_procedure_pin CHECK((procedure_id IS NULL)=(procedure_version IS NULL));
ALTER TABLE img.img_order ADD CONSTRAINT img_procedure_version_fk FOREIGN KEY(procedure_id,procedure_version) REFERENCES img.procedure(id,version);
CREATE FUNCTION img.guard_cancelled_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text; BEGIN
  SELECT status INTO state FROM img.img_order WHERE id=NEW.order_id FOR UPDATE;
  IF state='cancelled' THEN RAISE EXCEPTION 'Cancelled imaging request cannot receive studies or reports' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_cancelled_study BEFORE INSERT OR UPDATE OF order_id ON img.study FOR EACH ROW EXECUTE FUNCTION img.guard_cancelled_child();
CREATE TRIGGER guard_cancelled_report BEFORE INSERT OR UPDATE OF order_id ON img.report FOR EACH ROW EXECUTE FUNCTION img.guard_cancelled_child();
CREATE FUNCTION img.guard_cancelled_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN RAISE EXCEPTION 'Cancelled imaging request cannot be reopened' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_cancelled_order BEFORE UPDATE ON img.img_order FOR EACH ROW EXECUTE FUNCTION img.guard_cancelled_order();
CREATE FUNCTION img.protect_used_procedure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.code,NEW.name,NEW.modality,NEW.body_region,NEW.laterality_policy,NEW.instructions,NEW.version)
    IS DISTINCT FROM ROW(OLD.code,OLD.name,OLD.modality,OLD.body_region,OLD.laterality_policy,OLD.instructions,OLD.version)
    AND EXISTS(SELECT 1 FROM img.img_order WHERE procedure_id=OLD.id) THEN
    RAISE EXCEPTION 'Referenced procedure definitions require a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_used_procedure BEFORE UPDATE ON img.procedure FOR EACH ROW EXECUTE FUNCTION img.protect_used_procedure();
