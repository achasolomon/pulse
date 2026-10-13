import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../database/database.module.js';
import type { PulseDatabase } from '../database/db.types.js';

export type SecurityCategory =
  | 'authn'
  | 'authz'
  | 'break_glass'
  | 'admin'
  | 'integration'
  | 'device'
  | 'privacy'
  | 'abuse';

export type SecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type SecurityActorType = 'person' | 'partner' | 'device' | 'system' | 'unknown';

export interface SecurityEventInput {
  category: SecurityCategory;
  action: string;
  severity?: SecuritySeverity;
  actorType?: SecurityActorType;
  actorId?: string;
  facilityId?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Classify an HTTP failure into a SIEM security event (SEC-001 section 61
 * detection catalogue). Only auth-relevant statuses are classified; callers
 * drop `undefined` so routine 400/404/409 noise never reaches the SOC feed.
 */
export function classifySecurityFailure(
  status: number,
  code?: string,
): { category: SecurityCategory; severity: SecuritySeverity; action: string } | undefined {
  if (status === 429) {
    return { category: 'abuse', severity: 'medium', action: 'http.rate_limited' };
  }
  if (status === 401) {
    if (code === 'STAFF_SESSION_INVALID' || code === 'DEMO_DISABLED') {
      return { category: 'authn', severity: 'high', action: 'authn.session_rejected' };
    }
    if (code === 'DEVICE_TOKEN_INVALID') {
      return { category: 'device', severity: 'medium', action: 'device.token_rejected' };
    }
    if (code !== undefined && code.startsWith('PARTNER')) {
      return { category: 'integration', severity: 'medium', action: 'partner.key_rejected' };
    }
    if (code !== undefined && code.includes('SESSION')) {
      return { category: 'authn', severity: 'high', action: 'authn.session_rejected' };
    }
    return { category: 'authn', severity: 'medium', action: 'authn.credential_rejected' };
  }
  if (status === 403) {
    if (code !== undefined && code.startsWith('BREAK_GLASS')) {
      return { category: 'break_glass', severity: 'high', action: 'break_glass.rejected' };
    }
    if (
      code === 'DEVICE_SUSPENDED' ||
      code === 'DEVICE_DECOMMISSIONED' ||
      code === 'DEVICE_FACILITY_MISMATCH'
    ) {
      return { category: 'device', severity: 'high', action: 'device.access_denied' };
    }
    if (code === 'ACCESS_DENIED' || code === 'DEMO_DISABLED') {
      return { category: 'authz', severity: 'medium', action: 'authz.access_denied' };
    }
    return { category: 'authz', severity: 'low', action: 'authz.context_rejected' };
  }
  return undefined;
}

/** Derive a non-PHI actor triple from request headers (tokens never recorded). */
export function actorFromHeaders(headers: Record<string, string | string[] | undefined>): {
  actorType: SecurityActorType;
  actorId: string | undefined;
  facilityId: string | undefined;
} {
  const single = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const demoPerson = single('x-demo-person');
  if (demoPerson) return { actorType: 'person', actorId: demoPerson, facilityId: uuidOrUndef(single('x-facility-id')) };
  if (single('x-device-token')) {
    return { actorType: 'device', actorId: 'device-token', facilityId: uuidOrUndef(single('x-facility-id')) };
  }
  if (single('x-api-key')) {
    return { actorType: 'partner', actorId: 'partner-key', facilityId: uuidOrUndef(single('x-facility-id')) };
  }
  const auth = single('authorization');
  if (auth?.startsWith('Bearer staff_')) {
    return { actorType: 'person', actorId: 'staff-session', facilityId: uuidOrUndef(single('x-facility-id')) };
  }
  if (auth?.startsWith('Bearer ')) {
    return { actorType: 'person', actorId: 'bearer-session', facilityId: uuidOrUndef(single('x-facility-id')) };
  }
  return { actorType: 'unknown', actorId: undefined, facilityId: uuidOrUndef(single('x-facility-id')) };
}

function uuidOrUndef(v: string | undefined): string | undefined {
  return v && UUID_RE.test(v) ? v : undefined;
}

/**
 * Append-only security telemetry writer for the SIEM feed (SEC-001 60).
 * Never throws: a telemetry failure must not take down the request path.
 * Without a DATABASE_URL (unit/e2e) writes no-op like OutboxService.
 */
@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger(SecurityEventService.name);

  constructor(@Optional() @Inject(PULSE_DB) private readonly db?: Kysely<PulseDatabase>) {}

  async record(input: SecurityEventInput): Promise<void> {
    if (!process.env.DATABASE_URL || !this.db) return;
    try {
      await this.db
        .insertInto('security.event')
        .values({
          category: input.category,
          action: input.action,
          severity: input.severity ?? 'info',
          actor_type: input.actorType ?? 'unknown',
          ...(input.actorId ? { actor_id: input.actorId } : {}),
          ...(input.facilityId ? { facility_id: input.facilityId } : {}),
          ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
          ...(input.details ? { details: input.details } : {}),
        })
        .execute();
    } catch (err) {
      this.logger.warn(`security event write skipped: ${(err as Error).message}`);
    }
  }
}
