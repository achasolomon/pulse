import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  TaskStatus,
  WorkflowRepository,
} from '../domain/workflow.repository.js';

@Injectable()
export class KyselyWorkflowRepository implements WorkflowRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createTask(input: {
    kind: string;
    patientId?: string;
    facilityId: string;
    payload: Record<string, unknown>;
    dueAt?: string;
  }) {
    const r = await this.db
      .insertInto('workflow.task')
      .values({
        kind: input.kind,
        patient_id: input.patientId ?? null,
        facility_id: input.facilityId,
        payload: JSON.stringify(input.payload),
        due_at: input.dueAt ?? null,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as TaskStatus };
  }

  async findTask(id: string) {
    const r = await this.db
      .selectFrom('workflow.task')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as TaskStatus } : undefined;
  }

  async setTaskStatus(id: string, status: TaskStatus): Promise<void> {
    await this.db
      .updateTable('workflow.task')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  async openTasks(facilityId: string, limit: number) {
    const rows = await this.db
      .selectFrom('workflow.task')
      .select(['id', 'kind'])
      .where('facility_id', '=', facilityId)
      .where('status', '=', 'open')
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows;
  }

  async notify(input: { channel: 'in-app' | 'sms' | 'email'; recipient: string; body: string }) {
    const r = await this.db
      .insertInto('workflow.notification')
      .values(input)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }
}
