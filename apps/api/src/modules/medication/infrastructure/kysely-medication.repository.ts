import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  MedicationRepository,
  MedRequestStatus,
} from '../domain/medication.repository.js';

@Injectable()
export class KyselyMedicationRepository implements MedicationRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async defineMedication(input: {
    code: string;
    name: string;
    doseForm: string;
    strength: string;
    route: string;
  }) {
    const existing = await this.db
      .selectFrom('med.medication')
      .select(['id', 'version', 'name', 'dose_form', 'strength', 'route'])
      .where('code', '=', input.code)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    if (
      existing &&
      existing.name === input.name &&
      existing.dose_form === input.doseForm &&
      existing.strength === input.strength &&
      existing.route === input.route
    ) {
      return { id: existing.id, version: existing.version };
    }
    const r = await this.db
      .insertInto('med.medication')
      .values({
        code: input.code,
        name: input.name,
        dose_form: input.doseForm,
        strength: input.strength,
        route: input.route,
        version: (existing?.version ?? 0) + 1,
      })
      .returning(['id', 'version'])
      .executeTakeFirstOrThrow();
    return { id: r.id, version: r.version };
  }

  async findMedication(code: string) {
    const r = await this.db
      .selectFrom('med.medication')
      .select(['id', 'version'])
      .where('code', '=', code)
      .where('active', '=', true)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    return r ? { id: r.id, version: r.version } : undefined;
  }

  async prescribe(input: {
    patientId: string;
    encounterId: string;
    medicationId: string;
    dose: string;
    doseUnit: string;
    route: string;
    frequency: string;
  }) {
    const r = await this.db
      .insertInto('med.request')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId,
        medication_id: input.medicationId,
        dose: input.dose,
        dose_unit: input.doseUnit,
        route: input.route,
        frequency: input.frequency,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as MedRequestStatus };
  }

  async findRequest(id: string) {
    const r = await this.db
      .selectFrom('med.request')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as MedRequestStatus } : undefined;
  }

  async setStatus(
    id: string,
    status: MedRequestStatus,
    extra?: { holdReason?: string; cancelReason?: string },
  ): Promise<void> {
    await this.db
      .updateTable('med.request')
      .set({
        status,
        ...(extra?.holdReason ? { hold_reason: extra.holdReason } : {}),
        ...(extra?.cancelReason ? { cancel_reason: extra.cancelReason } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async dispense(requestId: string, input: { quantity: string; batch: string }) {
    const r = await this.db
      .insertInto('med.dispense')
      .values({ request_id: requestId, quantity: input.quantity, batch: input.batch })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async administer(
    requestId: string,
    input: { doseGiven: string; outcome: 'given' | 'not-given' | 'held'; reason: string },
  ) {
    const r = await this.db
      .insertInto('med.administration')
      .values({
        request_id: requestId,
        dose_given: input.doseGiven,
        outcome: input.outcome,
        reason: input.reason,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async administrations(requestId: string) {
    const rows = await this.db
      .selectFrom('med.administration')
      .select(['outcome'])
      .where('request_id', '=', requestId)
      .execute();
    return rows.map((r) => ({ outcome: r.outcome as 'given' | 'not-given' | 'held' }));
  }

  async prescriptionsFor(patientId: string, limit: number) {
    const rows = await this.db
      .selectFrom('med.request')
      .select(['id', 'status'])
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status }));
  }

  async contextForRequest(requestId: string) {
    const r = await this.db
      .selectFrom('med.request as q')
      .innerJoin('med.medication as m', 'm.id', 'q.medication_id')
      .select(['q.patient_id', 'q.encounter_id', 'm.code'])
      .where('q.id', '=', requestId)
      .executeTakeFirst();
    if (!r) return undefined;
    return { patientId: r.patient_id, encounterId: r.encounter_id, medicationCode: r.code };
  }
}
