-- Staff inbox is distinct from transport delivery and clinical acknowledgement.
ALTER TABLE workflow.task ADD COLUMN IF NOT EXISTS assigned_person_id uuid;
ALTER TABLE workflow.task ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE TABLE IF NOT EXISTS workflow.staff_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES org.organization(id),
  facility_id uuid NOT NULL REFERENCES org.facility(id),
  recipient_person_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES integration.outbox(id),
  task_id uuid NOT NULL REFERENCES workflow.task(id),
  category text NOT NULL DEFAULT 'task' CHECK (category IN ('task')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, recipient_person_id)
);
CREATE INDEX IF NOT EXISTS staff_notification_inbox_idx ON workflow.staff_notification
  (recipient_person_id, facility_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS staff_notification_unread_idx ON workflow.staff_notification
  (recipient_person_id, facility_id) WHERE read_at IS NULL;
-- Independent consumer checkpoint; never relies on global published_at.
CREATE TABLE IF NOT EXISTS workflow.staff_notification_delivery (
  event_id uuid PRIMARY KEY REFERENCES integration.outbox(id),
  processed_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('delivered', 'recipient_unavailable'))
);
CREATE INDEX IF NOT EXISTS staff_task_assignee_idx ON workflow.task
  (facility_id, assigned_person_id, created_at DESC);
