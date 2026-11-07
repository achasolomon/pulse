CREATE TABLE img.schedule_resource (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid NOT NULL REFERENCES org.facility(id),
 code text NOT NULL,name text NOT NULL,modality text NOT NULL,location text NOT NULL,
 active boolean NOT NULL DEFAULT true,blocked boolean NOT NULL DEFAULT false,block_reason text,
 CHECK(NOT blocked OR length(trim(block_reason))>0),UNIQUE(facility_id,code)
);
CREATE TABLE img.schedule_slot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES img.schedule_resource(id),
 procedure_id uuid NOT NULL REFERENCES img.procedure(id),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 active boolean NOT NULL DEFAULT true,CHECK(ends_at>starts_at),UNIQUE(resource_id,starts_at)
);
CREATE INDEX schedule_slot_time ON img.schedule_slot(resource_id,starts_at);
CREATE FUNCTION img.guard_schedule_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource img.schedule_resource; BEGIN
 SELECT * INTO resource FROM img.schedule_resource WHERE id=NEW.resource_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM img.procedure WHERE id=NEW.procedure_id AND modality=resource.modality) THEN
 RAISE EXCEPTION 'Slot procedure modality must match the resource' USING ERRCODE='23514';END IF;
 IF NEW.active AND EXISTS(SELECT 1 FROM img.schedule_slot s WHERE s.resource_id=NEW.resource_id AND s.id<>NEW.id AND s.active AND tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
 RAISE EXCEPTION 'Radiology capacity slots may not overlap' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM img.schedule_booking WHERE slot_id=OLD.id) AND ROW(NEW.resource_id,NEW.procedure_id,NEW.starts_at,NEW.ends_at) IS DISTINCT FROM ROW(OLD.resource_id,OLD.procedure_id,OLD.starts_at,OLD.ends_at) THEN
 RAISE EXCEPTION 'Booked slot definitions cannot change' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TABLE img.schedule_booking (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES img.img_order(id),
 slot_id uuid NOT NULL UNIQUE REFERENCES img.schedule_slot(id),protocol_review_id uuid NOT NULL REFERENCES img.protocol_review(id),
 order_version integer NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 booked_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER guard_schedule_slot BEFORE INSERT OR UPDATE ON img.schedule_slot FOR EACH ROW EXECUTE FUNCTION img.guard_schedule_slot();
CREATE FUNCTION img.protect_schedule_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scheduling evidence cannot be overwritten' USING ERRCODE='23514';END $$;
CREATE TRIGGER protect_schedule_booking BEFORE UPDATE ON img.schedule_booking FOR EACH ROW EXECUTE FUNCTION img.protect_schedule_booking();
