import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ReferralRepository,
  ReferralStatus,
} from '../domain/referral.repository.js';

@Injectable()
export class KyselyReferralRepository implements ReferralRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: {
    patientId: string;
    sendingFacilityId: string;
    receivingFacilityId?: string;
    type: string;
    urgency: string;
    clinicalQuestion: string;
  }) {
    const r = await this.db
      .insertInto('referral.case')
      .values({
        patient_id: input.patientId,
        sending_facility_id: input.sendingFacilityId,
        receiving_facility_id: input.receivingFacilityId ?? null,
        type: input.type,
        urgency: input.urgency,
        clinical_question: input.clinicalQuestion,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as ReferralStatus };
  }

  async findCase(id: string) {
    const r = await this.db
      .selectFrom('referral.case')
      .select([
        'id',
        'patient_id',
        'sending_facility_id',
        'receiving_facility_id',
        'status',
        'package_version',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      patientId: r.patient_id,
      sendingFacilityId: r.sending_facility_id,
      ...(r.receiving_facility_id ? { receivingFacilityId: r.receiving_facility_id } : {}),
      status: r.status as ReferralStatus,
      packageVersion: r.package_version,
    };
  }

  async setStatus(
    id: string,
    status: ReferralStatus,
    extra?: { receivingFacilityId?: string; cancelReason?: string },
  ): Promise<void> {
    await this.db
      .updateTable('referral.case')
      .set({
        status,
        ...(extra?.receivingFacilityId ? { receiving_facility_id: extra.receivingFacilityId } : {}),
        ...(extra?.cancelReason ? { cancel_reason: extra.cancelReason } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async savePackage(caseId: string, payload: Record<string, unknown>) {
    const current = await this.db
      .selectFrom('referral.case')
      .select(['package_version'])
      .where('id', '=', caseId)
      .executeTakeFirstOrThrow();
    const version = current.package_version + 1;
    await this.db
      .insertInto('referral.package')
      .values({ case_id: caseId, version, payload: JSON.stringify(payload) })
      .execute();
    await this.db
      .updateTable('referral.case')
      .set({ package_version: version })
      .where('id', '=', caseId)
      .execute();
    return { version };
  }

  async addMessage(caseId: string, authorId: string | undefined, body: string) {
    const r = await this.db
      .insertInto('referral.message')
      .values({ case_id: caseId, author_id: authorId ?? null, body })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async messages(caseId: string) {
    const rows = await this.db
      .selectFrom('referral.message')
      .select(['body'])
      .where('case_id', '=', caseId)
      .orderBy('created_at')
      .execute();
    return rows;
  }

  async inbox(facilityId: string, limit: number) {
    const rows = await this.db
      .selectFrom('referral.case')
      .select(['id', 'status'])
      .where('receiving_facility_id', '=', facilityId)
      .where('status', 'in', ['submitted', 'acknowledged', 'info-requested', 'accepted', 'scheduled', 'in-transit', 'arrived'])
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status as ReferralStatus }));
  }

  async casesFor(patientId: string, limit: number) {
    const rows = await this.db
      .selectFrom('referral.case')
      .select(['id', 'status'])
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status as ReferralStatus }));
  }
}
