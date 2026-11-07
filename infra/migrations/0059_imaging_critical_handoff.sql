CREATE TABLE img.critical_case (
 order_id uuid PRIMARY KEY REFERENCES img.img_order(id),report_id uuid NOT NULL UNIQUE REFERENCES img.staff_report_detail(report_id),
 facility_id uuid NOT NULL REFERENCES org.facility(id),recipient_id uuid NOT NULL,confirmed_by uuid NOT NULL,
 order_version integer NOT NULL,policy_reference text NOT NULL CHECK(length(trim(policy_reference)) BETWEEN 3 AND 500),
 due_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),version integer NOT NULL DEFAULT 1,
 acknowledged_by uuid,acknowledged_at timestamptz,acknowledgement_note text,
 CHECK((acknowledged_by IS NULL)=(acknowledged_at IS NULL)),
 CHECK((acknowledged_at IS NULL)=(acknowledgement_note IS NULL)),
 CHECK(acknowledged_by IS NULL OR acknowledged_by=recipient_id),
 CHECK(acknowledgement_note IS NULL OR length(trim(acknowledgement_note)) BETWEEN 3 AND 2000),
 CHECK(recipient_id<>confirmed_by),CHECK(due_at>created_at)
);
CREATE INDEX imaging_critical_pending ON img.critical_case(facility_id,recipient_id,due_at) WHERE acknowledged_at IS NULL;
CREATE TABLE img.critical_contact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES img.critical_case(order_id),actor_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN('phone','in-person')),outcome text NOT NULL CHECK(outcome IN('unreachable','reached')),
 read_back boolean NOT NULL,occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 2000),
 CHECK((outcome='reached' AND read_back) OR(outcome='unreachable' AND NOT read_back))
);
CREATE TRIGGER protect_imaging_critical_contact BEFORE UPDATE ON img.critical_contact FOR EACH ROW EXECUTE FUNCTION img.protect_protocol_evidence();
CREATE FUNCTION img.guard_imaging_critical_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN img.report rp ON rp.order_id=r.id JOIN img.staff_report_detail d ON d.report_id=rp.id
 WHERE r.id=NEW.order_id AND rp.id=NEW.report_id AND rp.status='draft' AND r.status='reported' AND p.facility_id=NEW.facility_id AND r.version=NEW.order_version
 AND d.priority IN('urgent','critical') AND length(trim(d.content->>'findings'))>0 AND length(trim(d.content->>'impression'))>0
 AND NOT EXISTS(SELECT 1 FROM img.report n WHERE n.order_id=r.id AND n.version>rp.version)) THEN
 RAISE EXCEPTION 'Handoff requires the current complete urgent/critical report' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_imaging_critical_case BEFORE INSERT ON img.critical_case FOR EACH ROW EXECUTE FUNCTION img.guard_imaging_critical_case();
CREATE FUNCTION img.freeze_imaging_critical_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM img.critical_case WHERE order_id=NEW.order_id) THEN
 RAISE EXCEPTION 'Communication pins the report; governed correction is required' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER freeze_imaging_critical_report BEFORE INSERT ON img.report FOR EACH ROW EXECUTE FUNCTION img.freeze_imaging_critical_report();
CREATE FUNCTION img.guard_imaging_critical_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.acknowledged_at IS NOT NULL OR NEW.version<>OLD.version+1 OR
 ROW(NEW.order_id,NEW.report_id,NEW.facility_id,NEW.recipient_id,NEW.confirmed_by,NEW.order_version,NEW.policy_reference,NEW.due_at,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.report_id,OLD.facility_id,OLD.recipient_id,OLD.confirmed_by,OLD.order_version,OLD.policy_reference,OLD.due_at,OLD.created_at) THEN
 RAISE EXCEPTION 'Handoff identity and acknowledged evidence are immutable' USING ERRCODE='23514';END IF;
 IF NEW.acknowledged_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM img.critical_contact WHERE order_id=OLD.order_id AND outcome='reached' AND read_back) THEN
 RAISE EXCEPTION 'Acknowledgement requires documented communication and read-back' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_imaging_critical_update BEFORE UPDATE ON img.critical_case FOR EACH ROW EXECUTE FUNCTION img.guard_imaging_critical_update();
CREATE FUNCTION img.guard_imaging_critical_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.critical_case WHERE order_id=NEW.order_id AND acknowledged_at IS NULL AND NEW.occurred_at>=created_at AND NEW.occurred_at<=clock_timestamp()+interval '1 minute') THEN
 RAISE EXCEPTION 'Contact requires an open handoff and actual valid time' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_imaging_critical_contact BEFORE INSERT ON img.critical_contact FOR EACH ROW EXECUTE FUNCTION img.guard_imaging_critical_contact();
CREATE OR REPLACE FUNCTION img.guard_report_signoff() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM img.report rp JOIN img.staff_report_detail d ON d.report_id=rp.id JOIN img.img_order r ON r.id=rp.order_id
 WHERE rp.id=NEW.report_id AND rp.status='draft' AND r.status='reported'
 AND(d.priority='routine' OR EXISTS(SELECT 1 FROM img.critical_case c WHERE c.order_id=r.id AND c.report_id=rp.id AND c.order_version=r.version AND c.acknowledged_at IS NOT NULL))
 AND length(trim(d.content->>'findings'))>0 AND length(trim(d.content->>'impression'))>0
 AND NOT EXISTS(SELECT 1 FROM img.report n WHERE n.order_id=r.id AND n.version>rp.version)) THEN
 RAISE EXCEPTION 'Sign-off requires the latest complete report and acknowledged urgent/critical handoff' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
