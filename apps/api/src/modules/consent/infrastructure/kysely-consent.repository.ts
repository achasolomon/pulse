import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ConsentPurpose,
  ConsentRepository,
} from '../domain/consent.repository.js';

@Injectable()
export class KyselyConsentRepository implements ConsentRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async capture(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    scope: string;
    validTo?: string;
  }) {
    const r = await this.db
      .insertInto('consent.consent')
      .values({
        patient_id: input.patientId,
        grantee: input.grantee,
        purpose: input.purpose,
        scope: input.scope,
        valid_to: input.validTo ?? null,
      })
      .returning(['id', 'patient_id', 'grantee', 'purpose', 'scope', 'status'])
      .executeTakeFirstOrThrow();
    return {
      id: r.id,
      patientId: r.patient_id,
      grantee: r.grantee,
      purpose: r.purpose as ConsentPurpose,
      scope: r.scope,
      status: r.status as 'granted' | 'withdrawn' | 'expired',
    };
  }

  async withdraw(id: string, reason: string): Promise<void> {
    await this.db
      .updateTable('consent.consent')
      .set({ status: 'withdrawn', withdraw_reason: reason })
      .where('id', '=', id)
      .execute();
  }

  async canDisclose(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    at?: Date;
  }): Promise<boolean> {
    const at = input.at ?? new Date();
    const r = await this.db
      .selectFrom('consent.consent')
      .select(['id'])
      .where('patient_id', '=', input.patientId)
      .where('grantee', '=', input.grantee)
      .where('purpose', '=', input.purpose)
      .where('status', '=', 'granted')
      .where('valid_from', '<=', at)
      .where((eb) =>
        eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', at)]),
      )
      .executeTakeFirst();
    return Boolean(r);
  }

  async logDisclosure(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    caseId?: string;
  }): Promise<void> {
    await this.db
      .insertInto('consent.disclosure')
      .values({
        patient_id: input.patientId,
        grantee: input.grantee,
        purpose: input.purpose,
        case_id: input.caseId ?? null,
      })
      .execute();
  }
}
