CREATE TABLE img.protocol_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,name text NOT NULL,
 procedure_id uuid NOT NULL REFERENCES img.procedure(id),version integer NOT NULL CHECK(version>0),
 instructions text NOT NULL,policy_reference text NOT NULL CHECK(length(trim(policy_reference))>0),
 checks jsonb NOT NULL CHECK(jsonb_typeof(checks)='array' AND jsonb_array_length(checks) BETWEEN 1 AND 30),
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(code,version),UNIQUE(id,version)
);
CREATE TABLE img.facility_protocol (
 facility_id uuid NOT NULL REFERENCES org.facility(id),template_id uuid NOT NULL REFERENCES img.protocol_template(id),
 active boolean NOT NULL DEFAULT true,PRIMARY KEY(facility_id,template_id)
);
CREATE TABLE img.protocol_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES img.img_order(id),
 template_id uuid NOT NULL,template_version integer NOT NULL,
 FOREIGN KEY(template_id,template_version) REFERENCES img.protocol_template(id,version),
 order_version integer NOT NULL CHECK(order_version>0),decision text NOT NULL CHECK(decision IN ('hold','approved')),
 responses jsonb NOT NULL CHECK(jsonb_typeof(responses)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 reviewed_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,order_version)
);
CREATE INDEX protocol_review_order ON img.protocol_review(order_id,order_version DESC);
CREATE FUNCTION img.protect_protocol_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Protocol reviews are immutable; record a subsequent review' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_protocol_evidence BEFORE UPDATE ON img.protocol_review FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE FUNCTION img.protect_used_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.code,NEW.name,NEW.procedure_id,NEW.version,NEW.instructions,NEW.policy_reference,NEW.checks)
 IS DISTINCT FROM ROW(OLD.code,OLD.name,OLD.procedure_id,OLD.version,OLD.instructions,OLD.policy_reference,OLD.checks)
 AND EXISTS(SELECT 1 FROM img.protocol_review WHERE template_id=OLD.id) THEN
 RAISE EXCEPTION 'Referenced protocols require a new version' USING ERRCODE='23514';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_used_protocol BEFORE UPDATE ON img.protocol_template FOR EACH ROW EXECUTE FUNCTION img.protect_used_protocol();
CREATE FUNCTION img.guard_protocol_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; BEGIN
 SELECT * INTO request FROM img.img_order WHERE id=NEW.order_id FOR UPDATE;
 IF request.status NOT IN ('ordered','scheduled') OR request.version<>NEW.order_version THEN
 RAISE EXCEPTION 'Protocol review requires the current unprocessed request' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM img.study WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=NEW.order_id) THEN
 RAISE EXCEPTION 'Protocol review is unavailable after processing' USING ERRCODE='23514';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_protocol_review BEFORE INSERT ON img.protocol_review FOR EACH ROW EXECUTE FUNCTION img.guard_protocol_review();
