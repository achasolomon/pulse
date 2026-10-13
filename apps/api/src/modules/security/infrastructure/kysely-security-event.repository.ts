import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  AuthFailureCluster,
  PatientTouchCluster,
  SecurityEvent,
  SecurityEventCursor,
  SecurityEventRepository,
} from '../domain/security-event.repository.js';

@Injectable()
export class KyselySecurityEventRepository implements SecurityEventRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async feed(
    since: SecurityEventCursor,
    limit: number,
    filter?: { severity?: string; category?: string },
  ): Promise<{ events: SecurityEvent[]; cursor: SecurityEventCursor }> {
    let q = this.db
      .selectFrom('security.event')
      .select([
        'id',
        'occurred_at',
        'category',
        'action',
        'severity',
        'actor_type',
        'actor_id',
        'facility_id',
        'correlation_id',
        'details',
      ])
      .select(sql<string>`occurred_at::text`.as('occurred_at_raw'))
      .orderBy('occurred_at')
      .orderBy('id')
      .limit(Math.min(Math.max(limit, 1), 500));
    if (since.lastOccurredAt && since.lastId) {
      // Compare with the full-precision timestamp string (not a JS Date):
      // toISOString() truncates microseconds and would re-emit the page
      // boundary row on the next page.
      q = q.where((eb) =>
        eb.or([
          eb('occurred_at', '>', sql<Date>`${since.lastOccurredAt}`),
          eb.and([
            eb('occurred_at', '=', sql<Date>`${since.lastOccurredAt}`),
            eb('id', '>', since.lastId as string),
          ]),
        ]),
      );
    }
    if (filter?.severity) q = q.where('severity', '=', filter.severity);
    if (filter?.category) q = q.where('category', '=', filter.category);
    const rows = await q.execute();
    const events: SecurityEvent[] = rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at.toISOString(),
      category: r.category,
      action: r.action,
      severity: r.severity,
      actorType: r.actor_type,
      ...(r.actor_id ? { actorId: r.actor_id } : {}),
      ...(r.facility_id ? { facilityId: r.facility_id } : {}),
      ...(r.correlation_id ? { correlationId: r.correlation_id } : {}),
      details:
        typeof r.details === 'string'
          ? (JSON.parse(r.details) as Record<string, unknown>)
          : (r.details as Record<string, unknown>),
    }));
    const last = rows[rows.length - 1];
    const cursor: SecurityEventCursor =
      last && last.occurred_at_raw
        ? { lastOccurredAt: last.occurred_at_raw, lastId: last.id }
        : since;
    return { events, cursor };
  }

  async repeatedAuthFailures(input: {
    since: Date;
    threshold: number;
  }): Promise<AuthFailureCluster[]> {
    const rows = await this.db
      .selectFrom('security.event')
      .select(({ fn }) => [
        'actor_id',
        'facility_id',
        fn.countAll<number>().as('failures'),
        fn.max<Date>('occurred_at').as('last_seen_at'),
      ])
      .where('occurred_at', '>=', input.since)
      .where('category', 'in', ['authn', 'device', 'abuse'])
      .where('severity', 'in', ['medium', 'high', 'critical'])
      .where('actor_id', 'is not', null)
      .groupBy(['actor_id', 'facility_id'])
      .having(sql<boolean>`count(*) >= ${input.threshold}`)
      .orderBy(sql`count(*) desc`)
      .limit(50)
      .execute();
    return rows.map((r) => ({
      actorId: String(r.actor_id),
      ...(r.facility_id ? { facilityId: r.facility_id } : {}),
      failures: Number(r.failures),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));
  }

  async massPatientTouches(input: {
    since: Date;
    threshold: number;
  }): Promise<PatientTouchCluster[]> {
    const rows = await this.db
      .selectFrom('audit.audit_event')
      .select(({ fn }) => [
        'actor_id',
        'facility_id',
        fn.countAll<number>().as('touches'),
        fn.max<Date>('occurred_at').as('last_seen_at'),
      ])
      .where('occurred_at', '>=', input.since)
      .where('resource_type', '=', 'patient')
      .groupBy(['actor_id', 'facility_id'])
      .having(sql<boolean>`count(*) >= ${input.threshold}`)
      .orderBy(sql`count(*) desc`)
      .limit(50)
      .execute();
    return rows.map((r) => ({
      ...(r.actor_id ? { actorId: r.actor_id } : {}),
      ...(r.facility_id ? { facilityId: r.facility_id } : {}),
      touches: Number(r.touches),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));
  }
}
