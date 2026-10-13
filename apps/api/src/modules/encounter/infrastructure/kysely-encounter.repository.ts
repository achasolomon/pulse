import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Encounter,
  EncounterRepository,
} from '../domain/encounter.repository.js';

@Injectable()
export class KyselyEncounterRepository implements EncounterRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async open(input: { patientId: string; facilityId: string; type: 'outpatient' | 'inpatient' | 'emergency' }): Promise<Encounter> {
    const r = await this.db
      .insertInto('encounter.encounter')
      .values({
        patient_id: input.patientId,
        facility_id: input.facilityId,
        type: input.type,
      })
      .returning(['id', 'patient_id', 'facility_id', 'type', 'status', 'department_id', 'bed', 'disposition'])
      .executeTakeFirstOrThrow();
    return this.map(r);
  }

  async findById(id: string): Promise<Encounter | undefined> {
    const r = await this.db
      .selectFrom('encounter.encounter')
      .select(['id', 'patient_id', 'facility_id', 'type', 'status', 'department_id', 'bed', 'disposition'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : undefined;
  }

  async applyTransition(input: {
    id: string;
    status: 'open' | 'admitted' | 'discharged' | 'cancelled';
    action: 'admit' | 'transfer' | 'discharge' | 'cancel';
    departmentId?: string;
    bed?: string;
    disposition?: string;
  }): Promise<Encounter> {
    return this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('encounter.encounter')
        .select(['department_id', 'bed'])
        .where('id', '=', input.id)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('encounter.transfer')
        .values({
          encounter_id: input.id,
          from_department_id: current.department_id,
          to_department_id: input.departmentId ?? current.department_id,
          from_bed: current.bed,
          to_bed: input.bed ?? current.bed ?? null,
          action: input.action,
        })
        .execute();
      const r = await trx
        .updateTable('encounter.encounter')
        .set({
          status: input.status,
          ...(input.departmentId !== undefined ? { department_id: input.departmentId } : {}),
          ...(input.bed !== undefined ? { bed: input.bed } : {}),
          ...(input.disposition !== undefined ? { disposition: input.disposition } : {}),
          ...(['discharged', 'cancelled'].includes(input.status) ? { ended_at: new Date() } : {}),
        })
        .where('id', '=', input.id)
        .returning(['id', 'patient_id', 'facility_id', 'type', 'status', 'department_id', 'bed', 'disposition'])
        .executeTakeFirstOrThrow();
      return this.map(r);
    });
  }

  async setCoverage(id: string, coverageId: string): Promise<void> {
    await this.db
      .updateTable('encounter.encounter')
      .set({ coverage_id: coverageId })
      .where('id', '=', id)
      .execute();
  }

  async listActive(facilityId: string, limit: number): Promise<Encounter[]> {
    const rows = await this.db
      .selectFrom('encounter.encounter')
      .select(['id', 'patient_id', 'facility_id', 'type', 'status', 'department_id', 'bed', 'disposition'])
      .where('facility_id', '=', facilityId)
      .where('status', 'in', ['open', 'admitted'])
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => this.map(r));
  }

  async listHistory(encounterId: string) {
    const rows = await this.db
      .selectFrom('encounter.transfer')
      .select(['action', 'to_department_id', 'to_bed'])
      .where('encounter_id', '=', encounterId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      action: r.action as 'admit' | 'transfer' | 'discharge' | 'cancel',
      ...(r.to_department_id ? { toDepartmentId: r.to_department_id } : {}),
      ...(r.to_bed ? { toBed: r.to_bed } : {}),
    }));
  }

  private map(r: {
    id: string;
    patient_id: string;
    facility_id: string;
    type: string;
    status: string;
    department_id: string | null;
    bed: string | null;
    disposition: string | null;
  }): Encounter {
    return {
      id: r.id,
      patientId: r.patient_id,
      facilityId: r.facility_id,
      type: r.type as Encounter['type'],
      status: r.status as Encounter['status'],
      ...(r.department_id ? { departmentId: r.department_id } : {}),
      ...(r.bed ? { bed: r.bed } : {}),
      ...(r.disposition ? { disposition: r.disposition } : {}),
    };
  }
}
