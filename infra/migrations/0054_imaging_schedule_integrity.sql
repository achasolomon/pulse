ALTER TABLE img.schedule_resource DROP CONSTRAINT IF EXISTS schedule_resource_check;
ALTER TABLE img.schedule_resource ADD CONSTRAINT schedule_resource_block_reason CHECK(NOT blocked OR (block_reason IS NOT NULL AND length(trim(block_reason))>0));
CREATE FUNCTION img.protect_schedule_resource() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.facility_id,NEW.modality) IS DISTINCT FROM ROW(OLD.facility_id,OLD.modality) AND EXISTS(SELECT 1 FROM img.schedule_slot WHERE resource_id=OLD.id) THEN
 RAISE EXCEPTION 'Configured resource facility and modality cannot change' USING ERRCODE='23514';END IF;
 IF ROW(NEW.name,NEW.location) IS DISTINCT FROM ROW(OLD.name,OLD.location) AND EXISTS(SELECT 1 FROM img.schedule_booking b JOIN img.schedule_slot s ON s.id=b.slot_id WHERE s.resource_id=OLD.id) THEN
 RAISE EXCEPTION 'Booked resource identity must be retained' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_schedule_resource BEFORE UPDATE ON img.schedule_resource FOR EACH ROW EXECUTE FUNCTION img.protect_schedule_resource();
CREATE FUNCTION img.guard_schedule_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; slot img.schedule_slot; resource img.schedule_resource; review img.protocol_review; BEGIN
 SELECT * INTO request FROM img.img_order WHERE id=NEW.order_id FOR UPDATE;
 SELECT r.* INTO resource FROM img.schedule_resource r JOIN img.schedule_slot s ON s.resource_id=r.id WHERE s.id=NEW.slot_id FOR UPDATE OF r;
 SELECT * INTO slot FROM img.schedule_slot WHERE id=NEW.slot_id FOR UPDATE;
 SELECT * INTO review FROM img.protocol_review WHERE order_id=NEW.order_id ORDER BY order_version DESC LIMIT 1;
 IF request.id IS NULL OR slot.id IS NULL OR resource.id IS NULL OR review.id IS NULL THEN
 RAISE EXCEPTION 'Scheduling requires a request, slot and planning decision' USING ERRCODE='23514';END IF;
 IF request.status<>'ordered' OR request.version<>NEW.order_version OR review.id<>NEW.protocol_review_id OR review.decision<>'approved' OR review.order_version+1<>request.version THEN
 RAISE EXCEPTION 'Scheduling requires current planning approval and request revision' USING ERRCODE='23514';END IF;
 IF NOT resource.active OR resource.blocked OR NOT slot.active OR slot.starts_at<=now() OR slot.procedure_id IS DISTINCT FROM request.procedure_id OR NOT EXISTS(SELECT 1 FROM patient.patient p WHERE p.id=request.patient_id AND p.facility_id=resource.facility_id AND p.status='active') THEN
 RAISE EXCEPTION 'Scheduling requires eligible facility capacity and patient' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM img.study WHERE order_id=request.id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=request.id) THEN
 RAISE EXCEPTION 'Processed requests cannot be scheduled' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_schedule_booking BEFORE INSERT ON img.schedule_booking FOR EACH ROW EXECUTE FUNCTION img.guard_schedule_booking();
