import 'reflect-metadata';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../../patient/domain/patient.repository.js';
import type { ResearchRepository } from '../domain/research.repository.js';
import { RESEARCH_REPOSITORY } from '../domain/research.repository.js';

@Injectable()
export class ResearchService {
  constructor(
    @Inject(RESEARCH_REPOSITORY) private readonly research: ResearchRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private async assertPatientInFacility(patientId: string, facilityId: string): Promise<void> {
    const patient = await this.patients.findById(patientId);
    if (patient === undefined) {
      throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: `patient ${patientId} not found` });
    }
    if (patient.facilityId !== facilityId) {
      throw new ConflictException({ code: 'PATIENT_FACILITY_MISMATCH', message: `patient ${patientId} belongs to a different facility than the study` });
    }
  }

  async createStudy(input: {
    facilityId: string;
    code: string;
    title: string;
    description: string;
  }) {
    if ((await this.research.findStudyByCode(input.code)) !== undefined) {
      throw new ConflictException({ code: 'STUDY_CODE_EXISTS', message: `study code ${input.code} already exists` });
    }
    const study = await this.research.createStudy(input);
    await this.outbox.publish({
      type: 'res.study_created',
      producer: 'research',
      aggregateType: 'study',
      aggregateId: study.id,
      payload: { studyId: study.id, code: study.code },
    });
    return study;
  }

  async approveStudy(input: { id: string; approver: string; note?: string }) {
    const study = await this.research.getStudy(input.id);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: `study ${input.id} not found` });
    if (study.status !== 'draft') {
      throw new ConflictException({ code: 'STUDY_STATE_INVALID', message: `study is ${study.status}; only draft studies can be approved` });
    }
    await this.research.approveStudy(input.id, input.approver, new Date());
    await this.outbox.publish({
      type: 'res.study_approved',
      producer: 'research',
      aggregateType: 'study',
      aggregateId: input.id,
      payload: { studyId: input.id, approver: input.approver },
    });
  }

  async closeStudy(input: { id: string; actor: string; reason: string }) {
    const study = await this.research.getStudy(input.id);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: `study ${input.id} not found` });
    if (study.status !== 'approved') {
      throw new ConflictException({ code: 'STUDY_STATE_INVALID', message: `study is ${study.status}; only approved studies can be closed` });
    }
    if (input.reason.trim().length < 5) {
      throw new BadRequestException({ code: 'REASON_TOO_SHORT', message: 'close reason must be at least 5 characters' });
    }
    await this.research.closeStudy(input.id, new Date());
    await this.outbox.publish({
      type: 'res.study_closed',
      producer: 'research',
      aggregateType: 'study',
      aggregateId: input.id,
      payload: { studyId: input.id, actor: input.actor, reason: input.reason },
    });
  }

  async getStudy(id: string) {
    const study = await this.research.getStudy(id);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: `study ${id} not found` });
    return study;
  }

  async listStudies(filter: { facilityId?: string; status?: 'draft' | 'approved' | 'closed' }) {
    return this.research.listStudies(filter);
  }

  async createCohort(input: { studyId: string; name: string; criteria: string }) {
    const study = await this.research.getStudy(input.studyId);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: `study ${input.studyId} not found` });
    if (study.status === 'closed') {
      throw new ConflictException({ code: 'STUDY_STATE_INVALID', message: 'study is closed; no new cohorts' });
    }
    if (input.criteria.trim().length < 5) {
      throw new BadRequestException({ code: 'CRITERIA_TOO_SHORT', message: 'cohort criteria must be at least 5 characters' });
    }
    const version = await this.research.nextCohortVersion(input.studyId, input.name);
    const cohort = await this.research.createCohort({ ...input, version });
    await this.outbox.publish({
      type: 'res.cohort_created',
      producer: 'research',
      aggregateType: 'cohort',
      aggregateId: cohort.id,
      payload: { studyId: input.studyId, cohortId: cohort.id, version },
    });
    return cohort;
  }

  async approveCohort(input: { id: string }) {
    const cohort = await this.research.getCohort(input.id);
    if (cohort === undefined) throw new NotFoundException({ code: 'COHORT_NOT_FOUND', message: `cohort ${input.id} not found` });
    if (cohort.status !== 'draft') {
      throw new ConflictException({ code: 'COHORT_STATE_INVALID', message: `cohort is ${cohort.status}; only draft cohorts can be approved` });
    }
    const study = await this.research.getStudy(cohort.studyId);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: 'cohort study not found' });
    if (study.status !== 'approved') {
      throw new ConflictException({ code: 'STUDY_NOT_APPROVED', message: 'study must be approved before cohort approval' });
    }
    await this.research.approveCohort(input.id);
    await this.outbox.publish({
      type: 'res.cohort_approved',
      producer: 'research',
      aggregateType: 'cohort',
      aggregateId: input.id,
      payload: { cohortId: input.id, studyId: cohort.studyId },
    });
  }

  async listCohorts(studyId: string) {
    await this.getStudy(studyId);
    return this.research.listCohorts(studyId);
  }

  async requestExport(input: {
    studyId: string;
    cohortId: string;
    requestedBy: string;
    patientIds: string[];
  }) {
    const study = await this.research.getStudy(input.studyId);
    if (study === undefined) throw new NotFoundException({ code: 'STUDY_NOT_FOUND', message: `study ${input.studyId} not found` });
    if (study.status !== 'approved') {
      throw new ConflictException({ code: 'STUDY_NOT_APPROVED', message: 'study must be approved before export request' });
    }
    const cohort = await this.research.getCohort(input.cohortId);
    if (cohort === undefined) throw new NotFoundException({ code: 'COHORT_NOT_FOUND', message: `cohort ${input.cohortId} not found` });
    if (cohort.studyId !== input.studyId) {
      throw new ConflictException({ code: 'COHORT_STUDY_MISMATCH', message: 'cohort does not belong to the study' });
    }
    if (cohort.status !== 'approved') {
      throw new ConflictException({ code: 'COHORT_NOT_APPROVED', message: 'cohort must be approved before export request' });
    }
    const unique = [...new Set(input.patientIds)];
    if (unique.length === 0) {
      throw new BadRequestException({ code: 'EXPORT_PATIENTS_REQUIRED', message: 'export requires at least one patient' });
    }
    for (const patientId of unique) {
      await this.assertPatientInFacility(patientId, study.facilityId);
    }
    const exportRow = await this.research.createExport({
      studyId: input.studyId,
      cohortDefinitionId: input.cohortId,
      requestedBy: input.requestedBy,
      patientIds: unique,
    });
    await this.outbox.publish({
      type: 'res.export_requested',
      producer: 'research',
      aggregateType: 'dataset_export',
      aggregateId: exportRow.id,
      payload: { exportId: exportRow.id, studyId: input.studyId, patients: unique.length },
    });
    return exportRow;
  }

  async decideExport(
    input: { id: string; decision: 'approved' | 'denied'; decisionBy: string; note: string },
  ) {
    const row = await this.research.getExport(input.id);
    if (row === undefined) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: `export ${input.id} not found` });
    if (row.status !== 'requested') {
      throw new ConflictException({ code: 'EXPORT_STATE_INVALID', message: `export is ${row.status}; only requested exports can be decided` });
    }
    if (input.note.trim().length < 5) {
      throw new BadRequestException({ code: 'REASON_TOO_SHORT', message: 'decision note must be at least 5 characters' });
    }
    await this.research.decideExport(input.id, {
      status: input.decision,
      decisionBy: input.decisionBy,
      note: input.note,
      decidedAt: new Date(),
    });
    await this.outbox.publish({
      type: input.decision === 'approved' ? 'res.export_approved' : 'res.export_denied',
      producer: 'research',
      aggregateType: 'dataset_export',
      aggregateId: input.id,
      payload: { exportId: input.id, decisionBy: input.decisionBy },
    });
  }

  /** Generate the de-identified export: pseudonyms are stable per study+patient. */
  async generateExport(input: { id: string }) {
    const row = await this.research.getExport(input.id);
    if (row === undefined) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: `export ${input.id} not found` });
    if (row.status !== 'approved') {
      throw new ConflictException({ code: 'EXPORT_STATE_INVALID', message: `export is ${row.status}; only approved exports can be generated` });
    }
    const links = await this.research.ensureSubjectLinks(row.studyId, row.patientIds);
    await this.research.markExported(input.id, links.length, new Date());
    await this.outbox.publish({
      type: 'res.export_generated',
      producer: 'research',
      aggregateType: 'dataset_export',
      aggregateId: input.id,
      payload: { exportId: input.id, rows: links.length, deidentified: true },
    });
    return {
      rowCount: links.length,
      subjects: links.map((l) => ({ patientId: l.patientId, pseudonym: l.pseudonym })),
    };
  }

  async revokeExport(input: { id: string; actor: string; reason: string }) {
    const row = await this.research.getExport(input.id);
    if (row === undefined) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: `export ${input.id} not found` });
    if (row.status !== 'exported') {
      throw new ConflictException({ code: 'EXPORT_STATE_INVALID', message: `export is ${row.status}; only exported exports can be revoked` });
    }
    if (input.reason.trim().length < 5) {
      throw new BadRequestException({ code: 'REASON_TOO_SHORT', message: 'revoke reason must be at least 5 characters' });
    }
    await this.research.revokeExport(input.id, input.reason, new Date());
    await this.outbox.publish({
      type: 'res.export_revoked',
      producer: 'research',
      aggregateType: 'dataset_export',
      aggregateId: input.id,
      payload: { exportId: input.id, actor: input.actor, reason: input.reason },
    });
  }

  async listExports(filter: {
    studyId?: string;
    status?: 'requested' | 'approved' | 'denied' | 'exported' | 'revoked';
  }) {
    return this.research.listExports(filter);
  }

  /** Re-identification vault list: pseudonym + patient for the study. */
  async listSubjects(studyId: string) {
    await this.getStudy(studyId);
    return this.research.listSubjectLinks(studyId);
  }

  async getExportById(id: string) {
    const row = await this.research.getExport(id);
    if (row === undefined) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', message: `export ${id} not found` });
    return row;
  }
}
