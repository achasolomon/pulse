import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  AccessType,
  DialysisRepository,
  DialysisSession,
  Program,
  ProgramStatus,
  Protocol,
  SessionStatus,
} from '../domain/dialysis.repository.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toDateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function toProtocol(r: {
  id: string;
  code: string;
  version: number;
  name: string;
  session_minutes: number;
  active: boolean;
}): Protocol {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    name: r.name,
    sessionMinutes: r.session_minutes,
    active: r.active,
  };
}

function toProgram(r: {
  id: string;
  patient_id: string;
  facility_id: string;
  protocol_id: string;
  access_type: string;
  target_weight_kg: number;
  status: string;
  start_date: string | Date;
  ended_at: Date | null;
}): Program {
  return {
    id: r.id,
    patientId: r.patient_id,
    facilityId: r.facility_id,
    protocolId: r.protocol_id,
    accessType: r.access_type as AccessType,
    targetWeightKg: Number(r.target_weight_kg),
    status: r.status as ProgramStatus,
    startDate: toDateOnly(r.start_date),
    ...(r.ended_at ? { endedAt: iso(r.ended_at) } : {}),
  };
}

function toSession(r: {
  id: string;
  program_id: string;
  encounter_id: string | null;
  protocol_id: string;
  scheduled_for: Date;
  status: string;
  pre_weight_kg: number | null;
  post_weight_kg: number | null;
  ultrafiltration_l: number | null;
  adverse_event: string | null;
  reason: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}): DialysisSession {
  return {
    id: r.id,
    programId: r.program_id,
    ...(r.encounter_id ? { encounterId: r.encounter_id } : {}),
    protocolId: r.protocol_id,
    scheduledFor: iso(r.scheduled_for),
    status: r.status as SessionStatus,
    ...(r.pre_weight_kg !== null ? { preWeightKg: Number(r.pre_weight_kg) } : {}),
    ...(r.post_weight_kg !== null ? { postWeightKg: Number(r.post_weight_kg) } : {}),
    ...(r.ultrafiltration_l !== null ? { ultrafiltrationL: Number(r.ultrafiltration_l) } : {}),
    ...(r.adverse_event ? { adverseEvent: r.adverse_event } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.started_at ? { startedAt: iso(r.started_at) } : {}),
    ...(r.completed_at ? { completedAt: iso(r.completed_at) } : {}),
  };
}

@Injectable()
export class KyselyDialysisRepository implements DialysisRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async listProtocols(activeOnly = false): Promise<Protocol[]> {
    let q = this.db.selectFrom('dial.protocol').selectAll().orderBy('code').orderBy('version');
    if (activeOnly) q = q.where('active', '=', true);
    const rows = await q.execute();
    return rows.map(toProtocol);
  }

  async getProtocol(id: string): Promise<Protocol | undefined> {
    const r = await this.db
      .selectFrom('dial.protocol')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toProtocol(r) : undefined;
  }

  async createProgram(input: {
    patientId: string;
    facilityId: string;
    protocolId: string;
    accessType: AccessType;
    targetWeightKg: number;
    startDate?: string;
  }): Promise<Program> {
    const r = await this.db
      .insertInto('dial.program')
      .values({
        patient_id: input.patientId,
        facility_id: input.facilityId,
        protocol_id: input.protocolId,
        access_type: input.accessType,
        target_weight_kg: input.targetWeightKg,
        ...(input.startDate ? { start_date: input.startDate } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProgram(r);
  }

  async getProgram(id: string): Promise<Program | undefined> {
    const r = await this.db
      .selectFrom('dial.program')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toProgram(r) : undefined;
  }

  async listPrograms(filter: {
    patientId?: string;
    facilityId?: string;
    status?: ProgramStatus;
  }): Promise<Program[]> {
    let q = this.db.selectFrom('dial.program').selectAll().orderBy('created_at');
    if (filter.patientId) q = q.where('patient_id', '=', filter.patientId);
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.status) q = q.where('status', '=', filter.status);
    const rows = await q.execute();
    return rows.map(toProgram);
  }

  async updateProgramStatus(
    id: string,
    input: { status: ProgramStatus; endedAt?: Date },
  ): Promise<void> {
    await this.db
      .updateTable('dial.program')
      .set({
        status: input.status,
        updated_at: new Date(),
        ...(input.endedAt ? { ended_at: input.endedAt } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async createSession(input: {
    programId: string;
    protocolId: string;
    scheduledFor: string;
    encounterId?: string;
  }): Promise<DialysisSession> {
    const r = await this.db
      .insertInto('dial.session')
      .values({
        program_id: input.programId,
        protocol_id: input.protocolId,
        scheduled_for: new Date(input.scheduledFor),
        ...(input.encounterId ? { encounter_id: input.encounterId } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toSession(r);
  }

  async getSession(id: string): Promise<DialysisSession | undefined> {
    const r = await this.db
      .selectFrom('dial.session')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toSession(r) : undefined;
  }

  async listSessions(programId: string): Promise<DialysisSession[]> {
    const rows = await this.db
      .selectFrom('dial.session')
      .selectAll()
      .where('program_id', '=', programId)
      .orderBy('scheduled_for')
      .execute();
    return rows.map(toSession);
  }

  async updateSession(
    id: string,
    input: {
      status?: SessionStatus;
      preWeightKg?: number;
      postWeightKg?: number;
      ultrafiltrationL?: number;
      adverseEvent?: string;
      reason?: string;
      scheduledFor?: string;
      startedAt?: Date;
      completedAt?: Date;
    },
  ): Promise<void> {
    await this.db
      .updateTable('dial.session')
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.preWeightKg !== undefined ? { pre_weight_kg: input.preWeightKg } : {}),
        ...(input.postWeightKg !== undefined ? { post_weight_kg: input.postWeightKg } : {}),
        ...(input.ultrafiltrationL !== undefined ? { ultrafiltration_l: input.ultrafiltrationL } : {}),
        ...(input.adverseEvent !== undefined ? { adverse_event: input.adverseEvent } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.scheduledFor !== undefined ? { scheduled_for: new Date(input.scheduledFor) } : {}),
        ...(input.startedAt !== undefined ? { started_at: input.startedAt } : {}),
        ...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
      })
      .where('id', '=', id)
      .execute();
  }
}
