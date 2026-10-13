import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { PULSE_DB } from '../database/database.module.js';
import type { PulseDatabase } from '../database/db.types.js';
export interface PublishEventInput {
  aggregateType: string;
  aggregateId: string;
  type: string;
  version?: number;
  producer: string;
  correlationId?: string;
  payload?: unknown;
  trx?: Transaction<PulseDatabase>;
}

export interface PublishedEvent {
  eventId: string;
  type: string;
  occurredAt: string;
}

/**
 * Transactional outbox writer (ADR-004 / EVT-001 section 7).
 * Callers pass their domain transaction so state + event commit atomically.
 * Without a DB (unit/e2e) it returns the envelope without persisting.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@Optional() @Inject(PULSE_DB) private readonly db?: Kysely<PulseDatabase>) {}

  async publish(input: PublishEventInput): Promise<PublishedEvent> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    if (!process.env.DATABASE_URL || !this.db) {
      this.logger.warn(`outbox skipped (no db): ${input.type}`);
      return { eventId, type: input.type, occurredAt };
    }
    const executor = input.trx ?? this.db;
    await executor
      .insertInto('integration.outbox')
      .values({
        id: eventId,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        type: input.type,
        version: input.version ?? 1,
        occurred_at: new Date(occurredAt),
        producer: input.producer,
        correlation_id: input.correlationId ?? null,
        payload: JSON.stringify(input.payload ?? {}),
      })
      .execute();
    return { eventId, type: input.type, occurredAt };
  }

  /**
   * Peek at unpublished events WITHOUT marking them: delivery stays the
   * relay's job. Consumers of the peek (e.g. the charge projector) must be
   * idempotent on their own keys.
   */
  async peekUnpublished(
    types: string[],
    limit: number,
  ): Promise<{ eventId: string; type: string; payload: Record<string, unknown> }[]> {
    if (!process.env.DATABASE_URL || !this.db || types.length === 0) return [];
    const rows = await this.db
      .selectFrom('integration.outbox')
      .select(['id', 'type', 'payload'])
      .where('published_at', 'is', null)
      .where('type', 'in', types)
      .orderBy('created_at')
      .limit(Math.min(Math.max(limit, 1), 500))
      .execute();
    return rows.map((r) => ({
      eventId: r.id,
      type: r.type,
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Record<
        string,
        unknown
      >,
    }));
  }
}
