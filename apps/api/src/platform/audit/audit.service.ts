import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../database/database.module.js';
import type { PulseDatabase } from '../database/db.types.js';

export interface AuditRecord {
  action: string;
  resourceType: string;
  resourceId?: string;
  actorId?: string;
  actorType?: string;
  tenantId?: string;
  facilityId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit writer (ARCH-001 section 16, DB-001 section 42).
 * Fail-open with warn when no DATABASE_URL is configured (dev/test without DB)
 * so platform tests stay green; production readiness (Sprint 05) flips to
 * fail-closed via AUDIT_STRICT=true.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Optional() @Inject(PULSE_DB) private readonly db?: Kysely<PulseDatabase>) {}

  async record(entry: AuditRecord): Promise<void> {
    if (!process.env.DATABASE_URL || !this.db) {
      this.logger.warn(
        `audit skipped (no db): ${entry.action} ${entry.resourceType}`,
      );
      return;
    }
    try {
      await this.db
        .insertInto('audit.audit_event')
        .values({
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          actor_id: entry.actorId ?? null,
          actor_type: entry.actorType ?? 'system',
          tenant_id: entry.tenantId ?? null,
          facility_id: entry.facilityId ?? null,
          correlation_id: entry.correlationId ?? null,
          metadata: JSON.stringify(entry.metadata ?? {}),
        })
        .execute();
    } catch (err) {
      if (process.env.AUDIT_STRICT === 'true') throw err;
      this.logger.warn(
        `audit write failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
