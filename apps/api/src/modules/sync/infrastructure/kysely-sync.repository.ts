import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  FeedCursor,
  SyncEvent,
  SyncRepository,
} from '../domain/sync.repository.js';

const EDGE_CONSUMER = 'edge-sync';

@Injectable()
export class KyselySyncRepository implements SyncRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async feed(
    since: FeedCursor,
    limit: number,
    capabilities?: string[],
  ): Promise<{ events: SyncEvent[]; cursor: FeedCursor }> {
    let q = this.db
      .selectFrom('integration.outbox')
      .select(['id', 'type', 'aggregate_id', 'occurred_at', 'payload', 'created_at'])
      .select(sql<string>`created_at::text`.as('created_at_raw'))
      .orderBy('created_at')
      .orderBy('id')
      .limit(Math.min(Math.max(limit, 1), 500));
    if (since.lastCreatedAt && since.lastId) {
      // Full-precision timestamp strings: JS Date truncates microseconds and
      // would re-emit the page boundary row on the next page.
      q = q.where((eb) =>
        eb.or([
          eb('created_at', '>', sql<Date>`${since.lastCreatedAt}`),
          eb.and([
            eb('created_at', '=', sql<Date>`${since.lastCreatedAt}`),
            eb('id', '>', since.lastId as string),
          ]),
        ]),
      );
    }
    // Approved local data subset (EPIC-21 F21.1): SQL-level filter so
    // pagination/cursors stay correct. '*' means unfiltered.
    if (capabilities && !capabilities.includes('*')) {
      const exact = capabilities.filter((c) => !c.endsWith('.'));
      const prefixes = capabilities.filter((c) => c.endsWith('.'));
      if (exact.length === 0 && prefixes.length === 0) {
        return { events: [], cursor: since };
      }
      q = q.where((eb) =>
        eb.or([
          ...(exact.length > 0 ? [eb('integration.outbox.type', 'in', exact)] : []),
          ...prefixes.map((p) => eb('integration.outbox.type', 'like', `${p}%`)),
        ]),
      );
    }
    const rows = await q.execute();
    const events: SyncEvent[] = rows.map((r) => ({
      eventId: r.id,
      type: r.type,
      aggregateId: r.aggregate_id,
      occurredAt: r.occurred_at.toISOString(),
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
    }));
    const last = rows[rows.length - 1];
    const cursor: FeedCursor =
      last && last.created_at_raw
        ? { lastCreatedAt: last.created_at_raw, lastId: last.id }
        : since;
    return { events, cursor };
  }

  async isApplied(eventId: string): Promise<boolean> {
    const r = await this.db
      .selectFrom('integration.inbox')
      .select(['id'])
      .where('event_id', '=', eventId)
      .where('consumer', '=', EDGE_CONSUMER)
      .executeTakeFirst();
    return Boolean(r);
  }

  async markApplied(eventId: string): Promise<void> {
    await this.db
      .insertInto('integration.inbox')
      .values({ event_id: eventId, consumer: EDGE_CONSUMER })
      .onConflict((oc) => oc.columns(['event_id', 'consumer']).doNothing())
      .execute();
  }

  async openConflict(input: {
    eventId: string;
    eventType: string;
    aggregateId: string;
    reason: string;
  }) {
    const r = await this.db
      .insertInto('integration.sync_conflict')
      .values({
        event_id: input.eventId,
        event_type: input.eventType,
        aggregate_id: input.aggregateId,
        reason: input.reason,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async resolveConflict(id: string, resolution: string): Promise<void> {
    await this.db
      .updateTable('integration.sync_conflict')
      .set({ status: 'resolved', resolution })
      .where('id', '=', id)
      .execute();
  }

  async findOpen(limit = 50) {
    const rows = await this.db
      .selectFrom('integration.sync_conflict')
      .select(['id', 'event_type', 'reason'])
      .where('status', '=', 'open')
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      reason: r.reason as 'DUPLICATE_PATIENT' | 'UNKNOWN_PATIENT' | 'UNKNOWN_ENCOUNTER' | 'UNKNOWN_TYPE',
    }));
  }

  async watermark(consumerId: string): Promise<FeedCursor> {
    const r = await this.db
      .selectFrom('integration.sync_state')
      .select(['last_created_at', 'last_id'])
      .where('consumer_id', '=', consumerId)
      .executeTakeFirst();
    if (!r || !r.last_created_at || !r.last_id) return {};
    return { lastCreatedAt: r.last_created_at.toISOString(), lastId: r.last_id };
  }

  async saveWatermark(consumerId: string, cursor: FeedCursor): Promise<void> {
    const at = cursor.lastCreatedAt ? new Date(cursor.lastCreatedAt) : null;
    await this.db
      .insertInto('integration.sync_state')
      .values({
        consumer_id: consumerId,
        last_created_at: at,
        last_id: cursor.lastId ?? null,
      })
      .onConflict((oc) =>
        oc.column('consumer_id').doUpdateSet({
          last_created_at: at,
          last_id: cursor.lastId ?? null,
          updated_at: new Date(),
        }),
      )
      .execute();
  }
}
