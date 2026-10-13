import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import type {
  ABO,
  BloodbankRepository,
  Rh,
  UnitStatus,
} from '../domain/bloodbank.repository.js';

@Injectable()
export class KyselyBloodbankRepository implements BloodbankRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async registerUnit(input: { bagId: string; abo: ABO; rh: Rh; expiresOn: string }) {
    const r = await this.db
      .insertInto('bank.unit')
      .values({
        bag_id: input.bagId,
        abo: input.abo,
        rh: input.rh,
        expires_on: input.expiresOn,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findUnit(id: string) {
    const r = await this.db
      .selectFrom('bank.unit')
      .select(['id', 'abo', 'rh', 'expires_on', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      abo: r.abo as ABO,
      rh: r.rh as Rh,
      ...(r.expires_on ? { expiresOn: toDateOnly(r.expires_on) } : {}),
      status: r.status as UnitStatus,
    };
  }

  async setUnitStatus(id: string, status: UnitStatus): Promise<void> {
    await this.db
      .updateTable('bank.unit')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  async recordCrossmatch(input: {
    patientId: string;
    unitId: string;
    result: 'compatible' | 'incompatible';
    performedBy?: string;
  }) {
    const r = await this.db
      .insertInto('bank.crossmatch')
      .values({
        patient_id: input.patientId,
        unit_id: input.unitId,
        result: input.result,
        performed_by: input.performedBy ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async latestCrossmatch(patientId: string, unitId: string) {
    const r = await this.db
      .selectFrom('bank.crossmatch')
      .select(['result'])
      .where('patient_id', '=', patientId)
      .where('unit_id', '=', unitId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return r ? { result: r.result } : undefined;
  }

  async startTransfusion(input: { patientId: string; encounterId?: string; unitId: string }) {
    const r = await this.db
      .insertInto('bank.transfusion')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId ?? null,
        unit_id: input.unitId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async finishTransfusion(
    id: string,
    outcome: { status: 'completed' | 'stopped'; reaction?: string; note?: string },
  ): Promise<void> {
    await this.db
      .updateTable('bank.transfusion')
      .set({
        status: outcome.status,
        reaction: outcome.reaction ?? null,
        reaction_note: outcome.note ?? '',
        ended_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }
}
