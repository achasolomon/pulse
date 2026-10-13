/** SIEM security-event feed + detection ports (SEC-001 section 60/61). */

export interface SecurityEventCursor {
  lastOccurredAt?: string;
  lastId?: string;
}

export function encodeSecurityCursor(cursor: SecurityEventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeSecurityCursor(raw: string): SecurityEventCursor {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { lastOccurredAt, lastId } = parsed as Record<string, unknown>;
    return {
      ...(typeof lastOccurredAt === 'string' ? { lastOccurredAt } : {}),
      ...(typeof lastId === 'string' ? { lastId } : {}),
    };
  } catch {
    throw new Error('SECURITY_CURSOR_INVALID');
  }
}

export interface SecurityEvent {
  id: string;
  occurredAt: string;
  category: string;
  action: string;
  severity: string;
  actorType: string;
  actorId?: string;
  facilityId?: string;
  correlationId?: string;
  details: Record<string, unknown>;
}

export interface AuthFailureCluster {
  actorId: string;
  facilityId?: string;
  failures: number;
  lastSeenAt: string;
}

export interface PatientTouchCluster {
  actorId?: string;
  facilityId?: string;
  touches: number;
  lastSeenAt: string;
}

export const SECURITY_EVENT_REPOSITORY = 'SECURITY_EVENT_REPOSITORY';

export interface SecurityEventRepository {
  feed(
    since: SecurityEventCursor,
    limit: number,
    filter?: { severity?: string; category?: string },
  ): Promise<{ events: SecurityEvent[]; cursor: SecurityEventCursor }>;
  repeatedAuthFailures(input: {
    since: Date;
    threshold: number;
  }): Promise<AuthFailureCluster[]>;
  massPatientTouches(input: {
    since: Date;
    threshold: number;
  }): Promise<PatientTouchCluster[]>;
}
