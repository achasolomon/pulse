-- Corrections require attributed workflow records, rather than overwriting recorded custody facts.
CREATE FUNCTION lab.protect_scoped_specimen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.identity_confirmed IS TRUE AND
    ROW(NEW.order_id,NEW.container,NEW.label,NEW.collected_at,NEW.collected_by,NEW.identity_confirmed)
    IS DISTINCT FROM ROW(OLD.order_id,OLD.container,OLD.label,OLD.collected_at,OLD.collected_by,OLD.identity_confirmed) THEN
    RAISE EXCEPTION 'Recorded specimen custody cannot be overwritten' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scoped_specimen_custody_guard BEFORE UPDATE ON lab.specimen
  FOR EACH ROW EXECUTE FUNCTION lab.protect_scoped_specimen();
CREATE FUNCTION lab.protect_specimen_accession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recorded specimen receipt cannot be overwritten' USING ERRCODE='23514'; END $$;
CREATE TRIGGER specimen_accession_custody_guard BEFORE UPDATE ON lab.specimen_accession
  FOR EACH ROW EXECUTE FUNCTION lab.protect_specimen_accession();
