CREATE TABLE img.booking_arrival (
 booking_id uuid PRIMARY KEY REFERENCES img.schedule_booking(id),
 identifier_methods text[] NOT NULL CHECK(cardinality(identifier_methods) BETWEEN 2 AND 3 AND identifier_methods <@ ARRAY['full-name','date-of-birth','mrn']::text[]),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),arrived_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER protect_booking_arrival BEFORE UPDATE ON img.booking_arrival FOR EACH ROW EXECUTE FUNCTION img.protect_schedule_booking();
CREATE FUNCTION img.guard_booking_arrival() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; BEGIN
 SELECT r.* INTO request FROM img.img_order r JOIN img.schedule_booking b ON b.order_id=r.id WHERE b.id=NEW.booking_id FOR UPDATE OF r;
 IF request.status<>'scheduled' OR NOT EXISTS(SELECT 1 FROM img.schedule_reservation WHERE booking_id=NEW.booking_id) OR EXISTS(SELECT 1 FROM img.study WHERE order_id=request.id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=request.id) THEN
 RAISE EXCEPTION 'Arrival requires an active unprocessed appointment' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT x) FROM unnest(NEW.identifier_methods) x)<>cardinality(NEW.identifier_methods) THEN
 RAISE EXCEPTION 'Two distinct patient identifiers are required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_arrival BEFORE INSERT ON img.booking_arrival FOR EACH ROW EXECUTE FUNCTION img.guard_booking_arrival();
ALTER TABLE img.booking_release DROP CONSTRAINT booking_release_kind_check;
ALTER TABLE img.booking_release ADD CONSTRAINT booking_release_kind_check CHECK(kind IN ('cancelled','rescheduled','no-show'));
CREATE OR REPLACE FUNCTION img.release_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request img.img_order; resource_id uuid; end_time timestamptz; BEGIN
 SELECT r.* INTO request FROM img.img_order r JOIN img.schedule_booking b ON b.order_id=r.id WHERE b.id=NEW.booking_id FOR UPDATE OF r;
 SELECT s.resource_id,s.ends_at INTO resource_id,end_time FROM img.schedule_slot s JOIN img.schedule_booking b ON b.slot_id=s.id WHERE b.id=NEW.booking_id;
 PERFORM id FROM img.schedule_resource WHERE id=resource_id FOR UPDATE;
 IF request.status<>'scheduled' OR NOT EXISTS(SELECT 1 FROM img.schedule_reservation WHERE booking_id=NEW.booking_id) OR EXISTS(SELECT 1 FROM img.study WHERE order_id=request.id) OR EXISTS(SELECT 1 FROM img.report WHERE order_id=request.id) THEN RAISE EXCEPTION 'Only active unprocessed appointments can be changed' USING ERRCODE='23514';END IF;
 IF NEW.kind='no-show' AND (end_time>now() OR EXISTS(SELECT 1 FROM img.booking_arrival WHERE booking_id=NEW.booking_id)) THEN
 RAISE EXCEPTION 'No-show requires an ended appointment without recorded arrival' USING ERRCODE='23514';END IF;
 DELETE FROM img.schedule_reservation WHERE booking_id=NEW.booking_id;
 RETURN NEW;
END $$;
