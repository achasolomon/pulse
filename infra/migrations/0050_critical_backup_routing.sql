CREATE TABLE lab.critical_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab.critical_case(order_id),
  recipient_id uuid NOT NULL,
  configured_by uuid NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000),
  mode text NOT NULL CHECK(mode IN ('immediate','at-deadline')),
  status text NOT NULL CHECK(status IN ('scheduled','active','blocked','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  decided_at timestamptz,
  decision text,
  UNIQUE(order_id,recipient_id),
  CHECK((status='active')=(activated_at IS NOT NULL))
);
CREATE INDEX critical_backup_due ON lab.critical_backup(order_id) WHERE status='scheduled';
ALTER TABLE lab.critical_contact ADD COLUMN recipient_id uuid;
-- Earlier contacts explicitly referred to the original named clinician.
ALTER TABLE lab.critical_contact DISABLE TRIGGER protect_critical_contact;
UPDATE lab.critical_contact a SET recipient_id=c.recipient_id FROM lab.critical_case c WHERE a.order_id=c.order_id;
ALTER TABLE lab.critical_contact ENABLE TRIGGER protect_critical_contact;
ALTER TABLE lab.critical_contact ALTER COLUMN recipient_id SET NOT NULL;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='lab.critical_case'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%acknowledged_by = recipient_id%' LOOP
    EXECUTE format('ALTER TABLE lab.critical_case DROP CONSTRAINT %I',c.conname);
  END LOOP;
END $$;
CREATE FUNCTION lab.validate_critical_ack_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.acknowledged_by IS NOT NULL AND NEW.acknowledged_by<>NEW.recipient_id
    AND NOT EXISTS(SELECT 1 FROM lab.critical_backup b WHERE b.order_id=NEW.order_id AND b.recipient_id=NEW.acknowledged_by AND b.status='active') THEN
    RAISE EXCEPTION 'Acknowledgement requires an active named recipient' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_critical_ack_recipient BEFORE UPDATE ON lab.critical_case FOR EACH ROW EXECUTE FUNCTION lab.validate_critical_ack_recipient();
CREATE FUNCTION lab.protect_critical_backup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.order_id,NEW.recipient_id,NEW.configured_by,NEW.reason,NEW.mode,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.recipient_id,OLD.configured_by,OLD.reason,OLD.mode,OLD.created_at)
    OR OLD.status<>'scheduled' THEN
    RAISE EXCEPTION 'Backup routing evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_critical_backup BEFORE UPDATE ON lab.critical_backup FOR EACH ROW EXECUTE FUNCTION lab.protect_critical_backup();
