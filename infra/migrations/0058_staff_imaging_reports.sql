CREATE TABLE img.staff_report_detail (
 report_id uuid PRIMARY KEY REFERENCES img.report(id),study_id uuid NOT NULL REFERENCES img.study(id),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 priority text NOT NULL CHECK(priority IN('routine','urgent','critical')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 supersedes_id uuid REFERENCES img.report(id)
);
CREATE TABLE img.report_signoff (
 report_id uuid PRIMARY KEY REFERENCES img.staff_report_detail(report_id),verified_by uuid NOT NULL,
 review_reference text NOT NULL CHECK(length(trim(review_reference)) BETWEEN 3 AND 500),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER protect_staff_report_detail BEFORE UPDATE ON img.staff_report_detail FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE TRIGGER protect_report_signoff BEFORE UPDATE ON img.report_signoff FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE FUNCTION img.guard_staff_report_detail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.report rp JOIN img.img_order r ON r.id=rp.order_id JOIN img.study s ON s.id=NEW.study_id AND s.order_id=r.id JOIN img.acquisition_completion done ON done.study_id=s.id
 WHERE rp.id=NEW.report_id AND rp.status='draft' AND r.status IN('acquired','reported') AND rp.author_id IS NOT NULL) THEN
 RAISE EXCEPTION 'Staff reporting requires a verified acquired study and attributed draft' USING ERRCODE='23514';END IF;
 IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM img.report prior_report JOIN img.report next_report ON next_report.id=NEW.report_id WHERE prior_report.id=NEW.supersedes_id AND prior_report.order_id=next_report.order_id AND prior_report.version<next_report.version AND prior_report.status='draft') THEN
 RAISE EXCEPTION 'Draft revision must reference an earlier draft of the same request' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_staff_report_detail BEFORE INSERT ON img.staff_report_detail FOR EACH ROW EXECUTE FUNCTION img.guard_staff_report_detail();
CREATE FUNCTION img.guard_report_signoff() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.report rp JOIN img.staff_report_detail d ON d.report_id=rp.id JOIN img.img_order r ON r.id=rp.order_id
 WHERE rp.id=NEW.report_id AND rp.status='draft' AND r.status='reported' AND d.priority='routine'
 AND length(trim(d.content->>'findings'))>0 AND length(trim(d.content->>'impression'))>0
 AND NOT EXISTS(SELECT 1 FROM img.report n WHERE n.order_id=r.id AND n.version>rp.version)) THEN
 RAISE EXCEPTION 'Sign-off requires the latest complete routine report; urgent/critical handoff is not yet enabled' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_report_signoff BEFORE INSERT ON img.report_signoff FOR EACH ROW EXECUTE FUNCTION img.guard_report_signoff();
CREATE FUNCTION img.protect_staff_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM img.staff_report_detail WHERE report_id=OLD.id) THEN
  IF OLD.status='final' OR ROW(NEW.id,NEW.order_id,NEW.text,NEW.version,NEW.author_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.text,OLD.version,OLD.author_id,OLD.created_at)
  OR NEW.status<>'final' OR NOT EXISTS(SELECT 1 FROM img.report_signoff WHERE report_id=OLD.id) THEN
   RAISE EXCEPTION 'Staff reports are immutable revisions; final reports require governed amendments' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_staff_report BEFORE UPDATE ON img.report FOR EACH ROW EXECUTE FUNCTION img.protect_staff_report();
