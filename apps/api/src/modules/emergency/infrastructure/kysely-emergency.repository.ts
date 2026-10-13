import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  AcuityLevel,
  EmergencyRepository,
} from '../domain/emergency.repository.js';

@Injectable()
export class KyselyEmergencyRepository implements EmergencyRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async recordAcuity(input: {
    encounterId: string;
    level: AcuityLevel;
    discriminator: string;
    overrideReason?: string;
    recordedBy?: string;
  }) {
    const r = await this.db
      .insertInto('emg.acuity')
      .values({
        encounter_id: input.encounterId,
        level: input.level,
        discriminator: input.discriminator,
        override_reason: input.overrideReason ?? null,
        recorded_by: input.recordedBy ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async latestAcuity(encounterId: string) {
    const r = await this.db
      .selectFrom('emg.acuity')
      .select(['encounter_id', 'level', 'discriminator', 'created_at'])
      .where('encounter_id', '=', encounterId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      encounterId: r.encounter_id,
      level: r.level as AcuityLevel,
      discriminator: r.discriminator,
      recordedAt: r.created_at.toISOString(),
    };
  }

  async waitingList(facilityId: string, limit: number) {
    const rows = await this.db
      .selectFrom('encounter.encounter as e')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('emg.acuity as a')
            .select(['a.encounter_id', 'a.level'])
            .distinctOn('a.encounter_id')
            .orderBy('a.encounter_id')
            .orderBy('a.created_at', 'desc')
            .as('latest'),
        (join) => join.onRef('latest.encounter_id', '=', 'e.id'),
      )
      .select(['e.id', 'e.patient_id', 'e.status', 'e.started_at', 'latest.level'])
      .where('e.facility_id', '=', facilityId)
      .where('e.type', '=', 'emergency')
      .where('e.status', 'in', ['open', 'admitted'])
      .orderBy('e.started_at')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      encounterId: r.id,
      patientId: r.patient_id,
      status: r.status,
      arrivedAt: r.started_at.toISOString(),
      ...(r.level !== null && r.level !== undefined ? { acuity: r.level as AcuityLevel } : {}),
    }));
  }
}
