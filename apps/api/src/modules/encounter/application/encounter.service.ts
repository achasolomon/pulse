import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PATIENT_REPOSITORY, type PatientRepository } from '../../patient/domain/patient.repository.js';
import {
  ENCOUNTER_REPOSITORY,
  transition,
  type EncounterAction,
  type EncounterRepository,
  type EncounterType,
} from '../domain/encounter.repository.js';

/**
 * Encounter application service (EPIC-06 F06.1–F06.4).
 * Cross-module via PatientRepository port only (never patient tables directly).
 * Every mutation validates the pure machine first, then persists + emits outbox.
 */
@Injectable()
export class EncounterService {
  constructor(
    @Inject(ENCOUNTER_REPOSITORY) private readonly repo: EncounterRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    private readonly outbox: OutboxService,
  ) {}

  async open(input: {
    patientId: string;
    facilityId: string;
    type: EncounterType;
    correlationId?: string;
  }) {
    const patient = await this.patients.findById(input.patientId);
    if (!patient) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: 'Patient not found' });
    if (patient.status !== 'active') {
      throw new BadRequestException({
        code: 'PATIENT_RETIRED',
        message: 'Cannot open encounter for a retired-duplicate record — use the survivor',
      });
    }
    if (patient.facilityId !== input.facilityId) {
      throw new BadRequestException({
        code: 'FACILITY_MISMATCH',
        message: 'Patient does not belong to this facility',
      });
    }
    const encounter = await this.repo.open(input);
    await this.outbox.publish({
      aggregateType: 'encounter',
      aggregateId: encounter.id,
      type: 'encounter.opened',
      producer: 'encounter',
      correlationId: input.correlationId,
      payload: { id: encounter.id, patientId: encounter.patientId },
    });
    return encounter;
  }

  private async act(
    id: string,
    action: EncounterAction,
    opts: { departmentId?: string; bed?: string; disposition?: string; correlationId?: string },
  ) {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException({ code: 'ENCOUNTER_NOT_FOUND', message: 'Encounter not found' });
    let status;
    try {
      status = transition(current.status, action, current.type);
    } catch {
      throw new UnprocessableEntityException({
        code: 'ENCOUNTER_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    const updated = await this.repo.applyTransition({ id, status, action, ...opts });
    await this.outbox.publish({
      aggregateType: 'encounter',
      aggregateId: id,
      type: `encounter.${action === 'cancel' ? 'cancelled' : action === 'transfer' ? 'transferred' : action === 'discharge' ? 'discharged' : 'admitted'}`,
      producer: 'encounter',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return updated;
  }

  admit(id: string, opts: { departmentId: string; bed?: string; correlationId?: string }) {
    return this.act(id, 'admit', opts);
  }

  transfer(id: string, opts: { departmentId: string; bed?: string; correlationId?: string }) {
    return this.act(id, 'transfer', opts);
  }

  discharge(id: string, opts: { disposition?: string; correlationId?: string }) {
    return this.act(id, 'discharge', opts);
  }

  cancel(id: string, opts: { correlationId?: string }) {
    return this.act(id, 'cancel', opts);
  }

  /** Coverage snapshot for the visit (CR-001 Phase 1b): audited at the endpoint. */
  async setCoverage(id: string, coverageId: string, opts: { correlationId?: string }) {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException({ code: 'ENCOUNTER_NOT_FOUND', message: 'Encounter not found' });
    await this.repo.setCoverage(id, coverageId);
    await this.outbox.publish({
      aggregateType: 'encounter',
      aggregateId: id,
      type: 'encounter.coverage_set',
      producer: 'encounter',
      correlationId: opts.correlationId,
      payload: { id, coverageId },
    });
    return { id, coverageId };
  }
}
