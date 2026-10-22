-- Serialize specimen/result insertion with cancellation, including legacy adapters.
CREATE FUNCTION lab.reject_cancelled_order_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM lab.lab_order WHERE id=NEW.order_id FOR UPDATE;
  IF current_status='cancelled' THEN
    RAISE EXCEPTION 'Cancelled orders cannot receive specimens or results' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER specimen_cancelled_order_guard BEFORE INSERT OR UPDATE OF order_id ON lab.specimen
  FOR EACH ROW EXECUTE FUNCTION lab.reject_cancelled_order_content();
CREATE TRIGGER result_cancelled_order_guard BEFORE INSERT OR UPDATE OF order_id ON lab.result
  FOR EACH ROW EXECUTE FUNCTION lab.reject_cancelled_order_content();
CREATE FUNCTION lab.protect_cancelled_order_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN
    RAISE EXCEPTION 'Cancelled orders cannot be reopened by changing status' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cancelled_order_status_guard BEFORE UPDATE OF status ON lab.lab_order
  FOR EACH ROW EXECUTE FUNCTION lab.protect_cancelled_order_status();
