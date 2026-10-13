import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  PATIENT_REPOSITORY,
  mrnSystem,
  scoreDuplicates,
  type PatientRepository,
  type RegisterPatientInput,
} from '../domain/patient.repository.js';
import type { DuplicateCandidate } from '../domain/types.js';

/**
 * Patient application service (EPIC-04 F04.1–F04.4).
 * Registration validates, checks duplicates for REVIEW (never blocks on REVIEW,
 * blocks only on exact CONFIRMED identifier clash to force merge workflow),
 * persists with MRN namespaced per facility, emits outbox facts.
 */
@Injectable()
export class PatientService {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
    private readonly outbox: OutboxService,
  ) {}

  async register(
    input: RegisterPatientInput & { correlationId?: string },
  ): Promise<{ patient: Awaited<ReturnType<PatientRepository['create']>>; duplicates: DuplicateCandidate[] }> {
    const identifiers = [
      ...(input.mrn
        ? [{ system: mrnSystem(input.facilityId), value: input.mrn, facilityId: input.facilityId }]
        : []),
      ...(input.externalIdentifiers ?? []),
    ];
    const existing = await this.repo.listFacilityPatients(input.facilityId, 200);
    const duplicates = scoreDuplicates(
      { familyName: input.familyName, dateOfBirth: input.dateOfBirth },
      existing,
      identifiers,
    );
    if (duplicates.some((d) => d.risk === 'CONFIRMED')) {
      throw new BadRequestException({
        code: 'POSSIBLE_DUPLICATE',
        message: 'Exact identifier match exists — review duplicates or merge instead of registering',
      });
    }
    const patient = await this.repo.create({ ...input, identifiers });
    await this.outbox.publish({
      aggregateType: 'patient',
      aggregateId: patient.id,
      type: 'patient.registered',
      producer: 'patient',
      correlationId: input.correlationId,
      payload: { id: patient.id, facilityId: patient.facilityId },
    });
    return { patient, duplicates };
  }

  duplicates(
    patientId: string,
    facilityId: string,
  ): Promise<DuplicateCandidate[]> {
    return this.reviewDuplicates(patientId, facilityId);
  }

  private async reviewDuplicates(
    patientId: string,
    facilityId: string,
  ): Promise<DuplicateCandidate[]> {
    const self = await this.repo.findById(patientId);
    if (!self) return [];
    const existing = (await this.repo.listFacilityPatients(facilityId, 200)).filter(
      (e) => e.patientId !== patientId,
    );
    return scoreDuplicates(
      { familyName: self.familyName, dateOfBirth: self.dateOfBirth },
      existing,
      self.identifiers,
    );
  }

  async merge(input: {
    survivorId: string;
    duplicateId: string;
    reason: string;
    mergedBy?: string;
    correlationId?: string;
  }): Promise<void> {
    if (input.survivorId === input.duplicateId) {
      throw new BadRequestException({
        code: 'MERGE_SELF',
        message: 'Survivor and duplicate must differ',
      });
    }
    await this.repo.merge(input);
    await this.outbox.publish({
      aggregateType: 'patient',
      aggregateId: input.survivorId,
      type: 'patient.merged',
      producer: 'patient',
      correlationId: input.correlationId,
      payload: { survivorId: input.survivorId, duplicateId: input.duplicateId },
    });
  }

  /** Responsible-party guarantor (CR-001 Phase 1b): nullable, audited at the endpoint. */
  async setGuarantor(
    id: string,
    input: { name: string; contact?: string; correlationId?: string },
  ): Promise<void> {
    await this.repo.setGuarantor(id, input);
    await this.outbox.publish({
      aggregateType: 'patient',
      aggregateId: id,
      type: 'patient.guarantor_set',
      producer: 'patient',
      correlationId: input.correlationId,
      payload: { id },
    });
  }
}
