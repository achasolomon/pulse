import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  LabOrder,
  LabRepository,
  LabTest,
} from '../domain/lab.repository.js';

@Injectable()
export class KyselyLabRepository implements LabRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async upsertTest(input: { code: string; name: string; specimenRequirement: string }): Promise<LabTest> {
    const existing = await this.db
      .selectFrom('lab.test')
      .select(['id', 'code', 'name', 'specimen_requirement', 'version', 'active'])
      .where('code', '=', input.code)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    if (existing && existing.name === input.name && existing.specimen_requirement === input.specimenRequirement) {
      return this.mapTest(existing);
    }
    // New version on change (or first version); retire never deletes history.
    const version = existing ? existing.version + 1 : 1;
    const r = await this.db
      .insertInto('lab.test')
      .values({
        code: input.code,
        name: input.name,
        specimen_requirement: input.specimenRequirement,
        version,
      })
      .returning(['id', 'code', 'name', 'specimen_requirement', 'version', 'active'])
      .executeTakeFirstOrThrow();
    return this.mapTest(r);
  }

  async findTest(code: string): Promise<LabTest | undefined> {
    const r = await this.db
      .selectFrom('lab.test')
      .select(['id', 'code', 'name', 'specimen_requirement', 'version', 'active'])
      .where('code', '=', code)
      .where('active', '=', true)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    return r ? this.mapTest(r) : undefined;
  }

  async order(input: {
    patientId: string;
    encounterId: string;
    testId: string;
    testVersion: number;
    urgency: 'stat' | 'urgent' | 'routine';
    indication: string;
  }): Promise<LabOrder> {
    const r = await this.db
      .insertInto('lab.lab_order')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId,
        test_id: input.testId,
        test_version: input.testVersion,
        urgency: input.urgency,
        indication: input.indication,
      })
      .returning(['id', 'patient_id', 'encounter_id', 'test_id', 'test_version', 'urgency', 'status'])
      .executeTakeFirstOrThrow();
    return this.mapOrder(r);
  }

  async findOrder(id: string) {
    const r = await this.db
      .selectFrom('lab.lab_order')
      .select(['id', 'patient_id', 'encounter_id', 'test_id', 'test_version', 'urgency', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.mapOrder(r) : undefined;
  }

  async setStatus(
    id: string,
    status: LabOrder['status'],
    extra?: { cancelReason?: string; verifiedBy?: string },
  ): Promise<LabOrder> {
    const r = await this.db
      .updateTable('lab.lab_order')
      .set({
        status,
        ...(extra?.cancelReason ? { cancel_reason: extra.cancelReason } : {}),
        ...(extra?.verifiedBy
          ? { verified_by: extra.verifiedBy, verified_at: new Date() }
          : {}),
      })
      .where('id', '=', id)
      .returning(['id', 'patient_id', 'encounter_id', 'test_id', 'test_version', 'urgency', 'status'])
      .executeTakeFirstOrThrow();
    return this.mapOrder(r);
  }

  async collectSpecimen(orderId: string, input: { container: string; label: string }) {
    const r = await this.db
      .insertInto('lab.specimen')
      .values({ order_id: orderId, container: input.container, label: input.label })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async addResult(
    orderId: string,
    input: { component: string; valueText: string; unit?: string; flag?: 'normal' | 'high' | 'low' | 'critical' },
  ) {
    const prev = await this.db
      .selectFrom('lab.result')
      .select(['version'])
      .where('order_id', '=', orderId)
      .where('component', '=', input.component)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    const r = await this.db
      .insertInto('lab.result')
      .values({
        order_id: orderId,
        component: input.component,
        value_text: input.valueText,
        unit: input.unit ?? null,
        flag: input.flag ?? null,
        version: (prev?.version ?? 0) + 1,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id, critical: input.flag === 'critical' };
  }

  async acknowledgeCritical(orderId: string, ackBy: string): Promise<void> {
    await this.db
      .updateTable('lab.lab_order')
      .set({ critical_ack_by: ackBy, critical_ack_at: new Date() })
      .where('id', '=', orderId)
      .execute();
  }

  async worklist(statuses: LabOrder['status'][], limit: number): Promise<LabOrder[]> {
    const rows = await this.db
      .selectFrom('lab.lab_order')
      .select(['id', 'patient_id', 'encounter_id', 'test_id', 'test_version', 'urgency', 'status'])
      .where('status', 'in', statuses)
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => this.mapOrder(r));
  }

  async ordersFor(patientId: string, limit: number): Promise<LabOrder[]> {
    const rows = await this.db
      .selectFrom('lab.lab_order')
      .select(['id', 'patient_id', 'encounter_id', 'test_id', 'test_version', 'urgency', 'status'])
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => this.mapOrder(r));
  }

  private mapTest(r: {
    id: string;
    code: string;
    name: string;
    specimen_requirement: string;
    version: number;
    active: boolean;
  }): LabTest {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      specimenRequirement: r.specimen_requirement,
      version: r.version,
      active: r.active,
    };
  }

  private mapOrder(r: {
    id: string;
    patient_id: string;
    encounter_id: string;
    test_id: string;
    test_version: number;
    urgency: string;
    status: string;
  }): LabOrder {
    return {
      id: r.id,
      patientId: r.patient_id,
      encounterId: r.encounter_id,
      testId: r.test_id,
      testVersion: r.test_version,
      urgency: r.urgency as LabOrder['urgency'],
      status: r.status as LabOrder['status'],
    };
  }
}
