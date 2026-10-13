import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PATIENT_REPOSITORY, type PatientRepository } from '../../patient/domain/patient.repository.js';
import {
  DIALYSIS_REPOSITORY,
  PROGRAM_TRANSITIONS,
  SESSION_TRANSITIONS,
  canTransition,
  validateWeights,
  type AccessType,
  type DialysisRepository,
  type ProgramStatus,
  type SessionStatus,
} from '../domain/dialysis.repository.js';

const DEFERRAL_MIN = 5;

/**
 * Dialysis recurring-care service (CLIN-001 section 22). Sessions are
 * attributable clinical events: legal transitions only, weights mandatory on
 * completion, protocol version snapshotted at scheduling time.
 */
@Injectable()
export class DialysisService {
  constructor(
    @Inject(DIALYSIS_REPOSITORY) private readonly repo: DialysisRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    private readonly outbox: OutboxService,
  ) {}

  protocols(activeOnly = false) {
    return this.repo.listProtocols(activeOnly);
  }

  async createProgram(input: {
    patientId: string;
    facilityId: string;
    protocolId: string;
    accessType: AccessType;
    targetWeightKg: number;
    startDate?: string;
    correlationId?: string;
  }) {
    const patient = await this.patients.findById(input.patientId);
    if (!patient) {
      throw new NotFoundException({
        code: 'PATIENT_NOT_FOUND',
        message: 'Unknown patient',
      });
    }
    if (patient.facilityId !== input.facilityId) {
      throw new UnprocessableEntityException({
        code: 'PROGRAM_FACILITY_MISMATCH',
        message: 'Program facility must match the patient record facility',
      });
    }
    const protocol = await this.repo.getProtocol(input.protocolId);
    if (!protocol || !protocol.active) {
      throw new NotFoundException({
        code: 'PROTOCOL_NOT_FOUND',
        message: 'Unknown or inactive protocol',
      });
    }
    if (input.targetWeightKg < 20 || input.targetWeightKg > 250) {
      throw new UnprocessableEntityException({
        code: 'TARGET_WEIGHT_IMPLAUSIBLE',
        message: 'Target weight must be within 20-250 kg',
      });
    }
    const program = await this.repo.createProgram(input);
    await this.outbox.publish({
      aggregateType: 'dialysis_program',
      aggregateId: program.id,
      type: 'dialysis.program_created',
      producer: 'dialysis',
      correlationId: input.correlationId,
      payload: { id: program.id, patientId: program.patientId },
    });
    return program;
  }

  getProgram(id: string) {
    return this.requireProgram(id);
  }

  listPrograms(filter: { patientId?: string; facilityId?: string; status?: ProgramStatus }) {
    return this.repo.listPrograms(filter);
  }

  async setProgramStatus(
    id: string,
    to: ProgramStatus,
    opts: { correlationId?: string } = {},
  ) {
    const program = await this.requireProgram(id);
    this.assertProgramTransition(program.status, to);
    await this.repo.updateProgramStatus(id, {
      status: to,
      ...(to === 'closed' ? { endedAt: new Date() } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'dialysis_program',
      aggregateId: id,
      type: `dialysis.program_${to}`,
      producer: 'dialysis',
      correlationId: opts.correlationId,
      payload: { id, from: program.status, to },
    });
    return { ...program, status: to };
  }

  async scheduleSession(
    programId: string,
    input: { scheduledFor: string; encounterId?: string; correlationId?: string },
  ) {
    const program = await this.requireProgram(programId);
    if (program.status !== 'active') {
      throw new ConflictException({
        code: 'PROGRAM_NOT_ACTIVE',
        message: `Cannot schedule on a ${program.status} program`,
      });
    }
    const session = await this.repo.createSession({
      programId,
      protocolId: program.protocolId,
      scheduledFor: input.scheduledFor,
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'dialysis_session',
      aggregateId: session.id,
      type: 'dialysis.session_scheduled',
      producer: 'dialysis',
      correlationId: input.correlationId,
      payload: { id: session.id, programId, protocolId: session.protocolId },
    });
    return session;
  }

  listSessions(programId: string) {
    return this.repo.listSessions(programId);
  }

  async transitionSession(
    id: string,
    to: SessionStatus,
    input: {
      preWeightKg?: number;
      postWeightKg?: number;
      adverseEvent?: string;
      reason?: string;
      scheduledFor?: string;
      correlationId?: string;
    } = {},
  ) {
    const session = await this.requireSession(id);
    this.assertSessionTransition(session.status, to);
    const program = await this.requireProgram(session.programId);

    if (to === 'in_progress' && program.status !== 'active') {
      throw new ConflictException({
        code: 'PROGRAM_NOT_ACTIVE',
        message: `Cannot start a session on a ${program.status} program`,
      });
    }

    if (to === 'deferred') {
      const reason = (input.reason ?? '').trim();
      if (reason.length < DEFERRAL_MIN) {
        throw new BadRequestException({
          code: 'DEFERRAL_REASON_REQUIRED',
          message: 'Deferral requires a reason (min 5 chars)',
        });
      }
      await this.repo.updateSession(id, { status: to, reason });
    } else if (to === 'scheduled') {
      if (!input.scheduledFor) {
        throw new BadRequestException({
          code: 'RESCHEDULE_TIME_REQUIRED',
          message: 'Reschedule requires a new scheduled time',
        });
      }
      await this.repo.updateSession(id, { status: to, scheduledFor: input.scheduledFor });
    } else if (to === 'completed') {
      const weights = validateWeights(input.preWeightKg, input.postWeightKg);
      if (!weights.ok) {
        throw new UnprocessableEntityException({
          code: weights.code,
          message: weights.message,
        });
      }
      await this.repo.updateSession(id, {
        status: to,
        preWeightKg: input.preWeightKg,
        postWeightKg: input.postWeightKg,
        ultrafiltrationL: weights.ultrafiltrationL,
        ...(input.adverseEvent ? { adverseEvent: input.adverseEvent } : {}),
        completedAt: new Date(),
      });
    } else if (to === 'in_progress') {
      await this.repo.updateSession(id, { status: to, startedAt: new Date() });
    } else if (to === 'cancelled') {
      const reason = (input.reason ?? '').trim();
      await this.repo.updateSession(id, {
        status: to,
        ...(reason ? { reason } : {}),
      });
    } else {
      await this.repo.updateSession(id, { status: to });
    }

    await this.outbox.publish({
      aggregateType: 'dialysis_session',
      aggregateId: id,
      type: `dialysis.session_${to}`,
      producer: 'dialysis',
      correlationId: input.correlationId,
      payload: {
        id,
        programId: session.programId,
        status: to,
        ...(to === 'completed' ? { adverseEvent: Boolean(input.adverseEvent) } : {}),
      },
    });
    return (await this.repo.getSession(id))!;
  }

  private async requireProgram(id: string) {
    const program = await this.repo.getProgram(id);
    if (!program) {
      throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Unknown program id' });
    }
    return program;
  }

  private async requireSession(id: string) {
    const session = await this.repo.getSession(id);
    if (!session) {
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Unknown session id' });
    }
    return session;
  }

  private assertProgramTransition(from: ProgramStatus, to: ProgramStatus) {
    if (!canTransition(PROGRAM_TRANSITIONS, from, to)) {
      throw new ConflictException({
        code: 'PROGRAM_STATE_INVALID',
        message: `Cannot move program from ${from} to ${to}`,
      });
    }
  }

  private assertSessionTransition(from: SessionStatus, to: SessionStatus) {
    if (!canTransition(SESSION_TRANSITIONS, from, to)) {
      throw new ConflictException({
        code: 'SESSION_STATE_INVALID',
        message: `Cannot move session from ${from} to ${to}`,
      });
    }
  }
}
