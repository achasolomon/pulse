import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../database/database.module.js';
import type { PulseDatabase } from '../database/db.types.js';

export interface ClaimedEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  version: number;
  payload: unknown;
}

/**
 * Outbox relay skeleton (Sprint 02). Production loop + broker publish land in
 * Sprint 03 with the worker boundary. claimBatch uses SELECT ... FOR UPDATE
 * SKIP LOCKED so multiple relays never double-deliver; consumers stay idempotent
 * via integration.inbox (ADR-004).
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(@Optional() @Inject(PULSE_DB) private readonly db?: Kysely<PulseDatabase>) {}

  async claimBatch(limit = 50): Promise<ClaimedEvent[]> {
    if (!process.env.DATABASE_URL || !this.db) return [];
    const rows = await sql<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      type: string;
      version: number;
      payload: unknown;
    }>`SELECT id, aggregate_type, aggregate_id, type, version, payload
       FROM integration.outbox
       WHERE published_at IS NULL
       ORDER BY created_at, id
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`.execute(this.db);
    return (rows.rows ?? []).map((r) => ({
      id: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      type: r.type,
      version: r.version,
      payload: r.payload,
    }));
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0 || !process.env.DATABASE_URL || !this.db) return;
    await this.db
      .updateTable('integration.outbox')
      .set({ published_at: new Date() })
      .where('id', 'in', ids)
      .execute();
    this.logger.log(`outbox marked published: ${ids.length}`);
  }
}
