import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  BreakGlassRepository,
} from '../domain/break-glass.repository.js';

@Injectable()
export class KyselyBreakGlassRepository implements BreakGlassRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: {
    personId: string;
    facilityId: string;
    patientId?: string;
    resourceType: string;
    action: string;
    reason: string;
    expiresAt: Date;
  }) {
    const r = await this.db
      .insertInto('iam.break_glass_grant')
      .values({
        person_id: input.personId,
        facility_id: input.facilityId,
        patient_id: input.patientId ?? null,
        resource_type: input.resourceType,
        action: input.action,
        reason: input.reason,
        expires_at: input.expiresAt,
      })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();
    return { id: r.id, expiresAt: r.expires_at };
  }

  async countRecent(personId: string, since: Date): Promise<number> {
    const r = await this.db
      .selectFrom('iam.break_glass_grant')
      .select(({ fn }) => fn.countAll<number>().as('n'))
      .where('person_id', '=', personId)
      .where('granted_at', '>=', since)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  async findActive(input: {
    personId: string;
    facilityId: string;
    patientId?: string;
    now: Date;
  }) {
    let q = this.db
      .selectFrom('iam.break_glass_grant')
      .select(['id', 'expires_at'])
      .where('person_id', '=', input.personId)
      .where('facility_id', '=', input.facilityId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', input.now);
    if (input.patientId) q = q.where('patient_id', '=', input.patientId);
    const r = await q.orderBy('granted_at', 'desc').executeTakeFirst();
    return r ? { id: r.id, expiresAt: r.expires_at } : undefined;
  }

  async expireDue(now: Date): Promise<{ id: string; personId: string }[]> {
    const due = await this.db
      .selectFrom('iam.break_glass_grant')
      .select(['id', 'person_id'])
      .where('revoked_at', 'is', null)
      .where('expires_at', '<=', now)
      .execute();
    if (due.length === 0) return [];
    await this.db
      .updateTable('iam.break_glass_grant')
      .set({ revoked_at: now })
      .where(
        'id',
        'in',
        due.map((d) => d.id),
      )
      .execute();
    return due.map((d) => ({ id: d.id, personId: d.person_id }));
  }
}
