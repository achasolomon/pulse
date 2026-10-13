import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Appointment,
  AppointmentRepository,
  AppointmentStatus,
} from '../domain/appointment.repository.js';

@Injectable()
export class KyselyAppointmentRepository implements AppointmentRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async book(input: {
    patientId: string;
    facilityId: string;
    departmentId?: string;
    scheduledAt: string;
    reason: string;
  }): Promise<Appointment> {
    const r = await this.db
      .insertInto('sched.appointment')
      .values({
        patient_id: input.patientId,
        facility_id: input.facilityId,
        department_id: input.departmentId ?? null,
        scheduled_at: new Date(input.scheduledAt),
        reason: input.reason,
      })
      .returning(['id', 'patient_id', 'facility_id', 'department_id', 'scheduled_at', 'reason', 'status'])
      .executeTakeFirstOrThrow();
    return this.map(r);
  }

  async findById(id: string) {
    const r = await this.db
      .selectFrom('sched.appointment')
      .select(['id', 'patient_id', 'facility_id', 'department_id', 'scheduled_at', 'reason', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : undefined;
  }

  async setStatus(id: string, status: AppointmentStatus, scheduledAt?: string) {
    const r = await this.db
      .updateTable('sched.appointment')
      .set({
        status,
        ...(scheduledAt ? { scheduled_at: new Date(scheduledAt) } : {}),
      })
      .where('id', '=', id)
      .returning(['id', 'patient_id', 'facility_id', 'department_id', 'scheduled_at', 'reason', 'status'])
      .executeTakeFirstOrThrow();
    return this.map(r);
  }

  async queue(facilityId: string, limit: number): Promise<Appointment[]> {
    const rows = await this.db
      .selectFrom('sched.appointment')
      .select(['id', 'patient_id', 'facility_id', 'department_id', 'scheduled_at', 'reason', 'status'])
      .where('facility_id', '=', facilityId)
      .where('status', 'in', ['scheduled', 'checked-in', 'in-progress'])
      .orderBy('scheduled_at')
      .limit(limit)
      .execute();
    return rows.map((r) => this.map(r));
  }

  async appointmentsFor(patientId: string, limit: number): Promise<Appointment[]> {
    const rows = await this.db
      .selectFrom('sched.appointment')
      .select(['id', 'patient_id', 'facility_id', 'department_id', 'scheduled_at', 'reason', 'status'])
      .where('patient_id', '=', patientId)
      .orderBy('scheduled_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => this.map(r));
  }

  private map(r: {
    id: string;
    patient_id: string;
    facility_id: string;
    department_id: string | null;
    scheduled_at: Date;
    reason: string;
    status: string;
  }): Appointment {
    return {
      id: r.id,
      patientId: r.patient_id,
      facilityId: r.facility_id,
      ...(r.department_id ? { departmentId: r.department_id } : {}),
      scheduledAt: r.scheduled_at.toISOString(),
      reason: r.reason,
      status: r.status as Appointment['status'],
    };
  }
}
