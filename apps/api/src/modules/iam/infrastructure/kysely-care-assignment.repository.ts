import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  CareAssignmentRepository,
} from '../domain/care-assignment.repository.js';

@Injectable()
export class KyselyCareAssignmentRepository implements CareAssignmentRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async findActive(input: {
    patientId: string;
    personId: string;
    facilityId: string;
  }) {
    const r = await this.db
      .selectFrom('iam.care_assignment')
      .select(['id'])
      .where('patient_id', '=', input.patientId)
      .where('person_id', '=', input.personId)
      .where('facility_id', '=', input.facilityId)
      .where('effective_from', '<=', new Date())
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>', new Date()),
        ]),
      )
      .executeTakeFirst();
    return r ? { id: r.id } : undefined;
  }

  async create(input: {
    patientId: string;
    personId: string;
    facilityId: string;
    kind: string;
    encounterId?: string;
    effectiveFrom?: Date;
    effectiveTo?: Date;
  }) {
    const r = await this.db
      .insertInto('iam.care_assignment')
      .values({
        patient_id: input.patientId,
        person_id: input.personId,
        facility_id: input.facilityId,
        kind: input.kind,
        encounter_id: input.encounterId ?? null,
        effective_from: input.effectiveFrom ?? new Date(),
        effective_to: input.effectiveTo ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }
}
