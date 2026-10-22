-- Serialise direct/legacy inserts with report confirmation, too.
CREATE OR REPLACE FUNCTION lab.freeze_critical_components() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM lab.lab_order WHERE id=NEW.order_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM lab.critical_case WHERE order_id=NEW.order_id) THEN
    RAISE EXCEPTION 'Critical communication pins the report; governed correction required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION lab.protect_critical_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.order_id,NEW.facility_id,NEW.recipient_id,NEW.confirmed_by,NEW.order_version,NEW.due_at,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.order_id,OLD.facility_id,OLD.recipient_id,OLD.confirmed_by,OLD.order_version,OLD.due_at,OLD.created_at)
     OR (OLD.acknowledged_at IS NOT NULL AND ROW(NEW.acknowledged_by,NEW.acknowledged_at) IS DISTINCT FROM ROW(OLD.acknowledged_by,OLD.acknowledged_at)) THEN
    RAISE EXCEPTION 'Critical responsibility and acknowledged evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_critical_case BEFORE UPDATE ON lab.critical_case FOR EACH ROW EXECUTE FUNCTION lab.protect_critical_case();
