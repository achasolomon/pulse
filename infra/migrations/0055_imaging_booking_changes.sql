ALTER TABLE img.schedule_booking DROP CONSTRAINT schedule_booking_order_id_key;
ALTER TABLE img.schedule_booking DROP CONSTRAINT schedule_booking_slot_id_key;
ALTER TABLE img.schedule_booking ADD CONSTRAINT booking_reservation_identity UNIQUE(id,order_id,slot_id);
CREATE TABLE img.schedule_reservation (
 order_id uuid PRIMARY KEY,slot_id uuid NOT NULL UNIQUE,booking_id uuid NOT NULL UNIQUE,
 FOREIGN KEY(booking_id,order_id,slot_id) REFERENCES img.schedule_booking(id,order_id,slot_id)
);
INSERT INTO img.schedule_reservation(order_id,slot_id,booking_id) SELECT order_id,slot_id,id FROM img.schedule_booking;
CREATE TABLE img.booking_release (
 booking_id uuid PRIMARY KEY REFERENCES img.schedule_booking(id),kind text NOT NULL CHECK(kind IN ('cancelled','rescheduled')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),released_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER protect_booking_release BEFORE UPDATE ON img.booking_release FOR EACH ROW EXECUTE FUNCTION img.protect_schedule_booking();
CREATE OR REPLACE FUNCTION img.guard_schedule_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; slot img.schedule_slot; resource img.schedule_resource; review img.protocol_review; BEGIN
 SELECT * INTO request FROM img.img_order WHERE id=NEW.order_id FOR UPDATE;
 SELECT r.* INTO resource FROM img.schedule_resource r JOIN img.schedule_slot s ON s.resource_id=r.id WHERE s.id=NEW.slot_id FOR UPDATE OF r;
 SELECT * INTO slot FROM img.schedule_slot WHERE id=NEW.slot_id FOR UPDATE;
 SELECT * INTO review FROM img.protocol_review WHERE order_id=NEW.order_id ORDER BY order_version DESC LIMIT 1;
 IF request.id IS NULL OR slot.id IS NULL OR resource.id IS NULL OR review.id IS NULL THEN RAISE EXCEPTION 'Scheduling prerequisites are missing' USING ERRCODE='23514';END IF;
 IF request.status NOT IN ('ordered','scheduled') OR request.version<>NEW.order_version OR review.id<>NEW.protocol_review_id OR review.decision<>'approved' OR review.order_version>=request.version THEN RAISE EXCEPTION 'Scheduling requires current planning approval and request revision' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM img.schedule_reservation WHERE order_id=request.id OR slot_id=slot.id) THEN RAISE EXCEPTION 'Capacity is already reserved' USING ERRCODE='23514';END IF;
 IF NOT resource.active OR resource.blocked OR NOT slot.active OR slot.starts_at<=now() OR slot.procedure_id IS DISTINCT FROM request.procedure_id OR NOT EXISTS(SELECT 1 FROM patient.patient p WHERE p.id=request.patient_id AND p.facility_id=resource.facility_id AND p.status='active') THEN RAISE EXCEPTION 'Scheduling requires eligible facility capacity and patient' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM img.study WHERE order_id=request.id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=request.id) THEN RAISE EXCEPTION 'Processed requests cannot be scheduled' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION img.reserve_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO img.schedule_reservation(order_id,slot_id,booking_id) VALUES(NEW.order_id,NEW.slot_id,NEW.id);RETURN NEW;END $$;
CREATE TRIGGER reserve_booking AFTER INSERT ON img.schedule_booking FOR EACH ROW EXECUTE FUNCTION img.reserve_booking();
CREATE FUNCTION img.release_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; resource_id uuid; BEGIN
 SELECT r.* INTO request FROM img.img_order r JOIN img.schedule_booking b ON b.order_id=r.id WHERE b.id=NEW.booking_id FOR UPDATE OF r;
 SELECT s.resource_id INTO resource_id FROM img.schedule_slot s JOIN img.schedule_booking b ON b.slot_id=s.id WHERE b.id=NEW.booking_id;
 PERFORM id FROM img.schedule_resource WHERE id=resource_id FOR UPDATE;
 IF request.status<>'scheduled' OR NOT EXISTS(SELECT 1 FROM img.schedule_reservation WHERE booking_id=NEW.booking_id) OR EXISTS(SELECT 1 FROM img.study WHERE order_id=request.id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=request.id) THEN RAISE EXCEPTION 'Only active unprocessed appointments can be changed' USING ERRCODE='23514';END IF;
 DELETE FROM img.schedule_reservation WHERE booking_id=NEW.booking_id;
 RETURN NEW;
END $$;
CREATE TRIGGER release_booking BEFORE INSERT ON img.booking_release FOR EACH ROW EXECUTE FUNCTION img.release_booking();
