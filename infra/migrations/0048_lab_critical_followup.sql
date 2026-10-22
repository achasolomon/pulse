-- Accountable critical communication is separate from inbox read and report release.
CREATE TABLE lab.critical_case (
  order_id uuid PRIMARY KEY REFERENCES lab.lab_order(id),
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  recipient_id uuid NOT NULL,
  confirmed_by uuid NOT NULL,
  order_version integer NOT NULL,
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CHECK ((acknowledged_by IS NULL)=(acknowledged_at IS NULL)),
  CHECK (acknowledged_by IS NULL OR acknowledged_by=recipient_id)
);
CREATE INDEX critical_case_pending ON lab.critical_case(facility_id,recipient_id,due_at) WHERE acknowledged_at IS NULL;
CREATE TABLE lab.critical_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab.critical_case(order_id),
  actor_id uuid NOT NULL,
  channel text NOT NULL CHECK(channel IN ('phone','in-person')),
  outcome text NOT NULL CHECK(outcome IN ('unreachable','reached')),
  read_back boolean NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(outcome<>'reached' OR read_back),
  CHECK(outcome<>'unreachable' OR NOT read_back)
);
CREATE FUNCTION lab.freeze_critical_components() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM lab.critical_case WHERE order_id=NEW.order_id) THEN
    RAISE EXCEPTION 'Critical communication pins the report; governed correction required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_critical_components BEFORE INSERT OR UPDATE ON lab.result FOR EACH ROW EXECUTE FUNCTION lab.freeze_critical_components();
CREATE FUNCTION lab.protect_critical_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contact evidence is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER protect_critical_contact BEFORE UPDATE ON lab.critical_contact FOR EACH ROW EXECUTE FUNCTION lab.protect_critical_contact();
