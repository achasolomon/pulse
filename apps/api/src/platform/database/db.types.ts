export interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  type: string;
  version: number;
  occurred_at: Date;
  producer: string;
  correlation_id: string | null;
  payload: unknown;
  created_at: Date;
  published_at: Date | null;
}

export interface InboxRow {
  id: string;
  event_id: string;
  consumer: string;
  received_at: Date;
}

export interface AuditEventRow {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  tenant_id: string | null;
  facility_id: string | null;
  correlation_id: string | null;
  metadata: unknown;
  created_at: Date;
}

export interface PulseDatabase {
  'integration.outbox': OutboxRow;
  'integration.inbox': InboxRow;
  'audit.audit_event': AuditEventRow;
}
