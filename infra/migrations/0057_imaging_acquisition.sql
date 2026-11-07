CREATE TABLE img.acquisition_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,name text NOT NULL,
 procedure_id uuid NOT NULL REFERENCES img.procedure(id),version integer NOT NULL CHECK(version>0),
 dicom_modality text NOT NULL CHECK(dicom_modality ~ '^[A-Z0-9]{1,16}$'),
 instructions text NOT NULL,policy_reference text NOT NULL CHECK(length(trim(policy_reference))>0),
 checks jsonb NOT NULL CHECK(jsonb_typeof(checks)='array' AND jsonb_array_length(checks) BETWEEN 1 AND 30),
 active boolean NOT NULL DEFAULT true,UNIQUE(code,version),UNIQUE(id,version)
);
CREATE TABLE img.facility_acquisition_template (
 facility_id uuid NOT NULL REFERENCES org.facility(id),template_id uuid NOT NULL REFERENCES img.acquisition_template(id),
 active boolean NOT NULL DEFAULT true,PRIMARY KEY(facility_id,template_id)
);
CREATE TABLE img.acquisition_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES img.img_order(id),
 booking_id uuid NOT NULL REFERENCES img.schedule_booking(id),template_id uuid NOT NULL,template_version integer NOT NULL,
 FOREIGN KEY(template_id,template_version) REFERENCES img.acquisition_template(id,version),
 order_version integer NOT NULL CHECK(order_version>0),
 study_uid text NOT NULL UNIQUE CHECK(length(study_uid)<=64 AND study_uid ~ '^[0-9]+(\.[0-9]+)+$'),
 accession text NOT NULL UNIQUE CHECK(length(accession) BETWEEN 1 AND 16),
 patient_id_value text NOT NULL CHECK(length(patient_id_value) BETWEEN 1 AND 64),issuer text NOT NULL,
 birth_date text CHECK(birth_date ~ '^[0-9]{8}$'),dicom_modality text NOT NULL,
 responses jsonb NOT NULL CHECK(jsonb_typeof(responses)='object'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 prepared_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE img.acquisition_completion (
 case_id uuid PRIMARY KEY REFERENCES img.acquisition_case(id),study_id uuid NOT NULL UNIQUE REFERENCES img.study(id),
 series_count integer NOT NULL CHECK(series_count>0),instance_count integer NOT NULL CHECK(instance_count>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),verified_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER protect_acquisition_case BEFORE UPDATE ON img.acquisition_case FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE TRIGGER protect_acquisition_completion BEFORE UPDATE ON img.acquisition_completion FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE FUNCTION img.protect_used_acquisition_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.code,NEW.name,NEW.procedure_id,NEW.version,NEW.dicom_modality,NEW.instructions,NEW.policy_reference,NEW.checks)
 IS DISTINCT FROM ROW(OLD.code,OLD.name,OLD.procedure_id,OLD.version,OLD.dicom_modality,OLD.instructions,OLD.policy_reference,OLD.checks)
 AND EXISTS(SELECT 1 FROM img.acquisition_case WHERE template_id=OLD.id) THEN
 RAISE EXCEPTION 'Referenced acquisition templates require a new version' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_used_acquisition_template BEFORE UPDATE ON img.acquisition_template FOR EACH ROW EXECUTE FUNCTION img.protect_used_acquisition_template();
CREATE FUNCTION img.guard_acquisition_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; BEGIN
 SELECT * INTO request FROM img.img_order WHERE id=NEW.order_id FOR UPDATE;
 IF request.status<>'scheduled' OR request.version<>NEW.order_version OR NOT EXISTS(
 SELECT 1 FROM img.schedule_reservation b JOIN img.booking_arrival a ON a.booking_id=b.booking_id
 WHERE b.order_id=NEW.order_id AND b.booking_id=NEW.booking_id)
 OR EXISTS(SELECT 1 FROM img.study WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=NEW.order_id) THEN
 RAISE EXCEPTION 'Acquisition preparation requires the current arrived unprocessed appointment' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM img.acquisition_template t WHERE t.id=NEW.template_id AND t.version=NEW.template_version AND t.procedure_id=request.procedure_id AND t.dicom_modality=NEW.dicom_modality) THEN
 RAISE EXCEPTION 'Acquisition template does not match the procedure' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_acquisition_case BEFORE INSERT ON img.acquisition_case FOR EACH ROW EXECUTE FUNCTION img.guard_acquisition_case();
CREATE FUNCTION img.guard_acquisition_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.acquisition_case c JOIN img.img_order r ON r.id=c.order_id JOIN img.study s ON s.id=NEW.study_id
 WHERE c.id=NEW.case_id AND r.status='protocolled' AND s.order_id=c.order_id AND s.study_uid=c.study_uid AND s.accession=c.accession AND s.modality=c.dicom_modality) THEN
 RAISE EXCEPTION 'Completion requires the prepared request and matching study' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_acquisition_completion BEFORE INSERT ON img.acquisition_completion FOR EACH ROW EXECUTE FUNCTION img.guard_acquisition_completion();
