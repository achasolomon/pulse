import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import type { PatientSummary } from '../../patient/domain/types.js';
import { ResearchService } from './research.service.js';
import type {
  CohortDefinition,
  DatasetExport,
  ExportStatus,
  ResearchRepository,
  Study,
  StudyStatus,
  SubjectLink,
} from '../domain/research.repository.js';

const FACILITY = '11111111-1111-4111-8111-111111111111';
const PATIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PATIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class FakeResearchRepo implements ResearchRepository {
  studies = new Map<string, Study>();
  cohorts = new Map<string, CohortDefinition>();
  exports = new Map<string, DatasetExport>();
  links: SubjectLink[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  async createStudy(input: {
    facilityId: string;
    code: string;
    title: string;
    description: string;
  }): Promise<Study> {
    const study: Study = {
      id: this.nextId(),
      facilityId: input.facilityId,
      code: input.code,
      title: input.title,
      description: input.description,
      status: 'draft',
    };
    this.studies.set(study.id, study);
    return study;
  }

  async findStudyByCode(code: string): Promise<Study | undefined> {
    return [...this.studies.values()].find((s) => s.code === code);
  }

  async getStudy(id: string): Promise<Study | undefined> {
    return this.studies.get(id);
  }

  async listStudies(filter: { facilityId?: string; status?: StudyStatus }): Promise<Study[]> {
    return [...this.studies.values()].filter(
      (s) =>
        (filter.facilityId === undefined || s.facilityId === filter.facilityId) &&
        (filter.status === undefined || s.status === filter.status),
    );
  }

  async approveStudy(id: string, approver: string, approvedAt: Date): Promise<void> {
    const s = this.studies.get(id);
    if (s !== undefined) {
      s.status = 'approved';
      s.approvedBy = approver;
      s.approvedAt = approvedAt.toISOString();
    }
  }

  async closeStudy(id: string, closedAt: Date): Promise<void> {
    const s = this.studies.get(id);
    if (s !== undefined) {
      s.status = 'closed';
      s.closedAt = closedAt.toISOString();
    }
  }

  async createCohort(input: {
    studyId: string;
    name: string;
    version: number;
    criteria: string;
  }): Promise<CohortDefinition> {
    const cohort: CohortDefinition = { id: this.nextId(), status: 'draft', ...input };
    this.cohorts.set(cohort.id, cohort);
    return cohort;
  }

  async getCohort(id: string): Promise<CohortDefinition | undefined> {
    return this.cohorts.get(id);
  }

  async listCohorts(studyId: string): Promise<CohortDefinition[]> {
    return [...this.cohorts.values()].filter((c) => c.studyId === studyId);
  }

  async nextCohortVersion(studyId: string, name: string): Promise<number> {
    const versions = [...this.cohorts.values()]
      .filter((c) => c.studyId === studyId && c.name === name)
      .map((c) => c.version);
    return (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
  }

  async approveCohort(id: string): Promise<void> {
    const c = this.cohorts.get(id);
    if (c !== undefined) c.status = 'approved';
  }

  async createExport(input: {
    studyId: string;
    cohortDefinitionId: string;
    requestedBy: string;
    patientIds: string[];
  }): Promise<DatasetExport> {
    const row: DatasetExport = {
      id: this.nextId(),
      studyId: input.studyId,
      cohortDefinitionId: input.cohortDefinitionId,
      requestedBy: input.requestedBy,
      patientIds: input.patientIds,
      status: 'requested',
      deidentified: true,
    };
    this.exports.set(row.id, row);
    return row;
  }

  async getExport(id: string): Promise<DatasetExport | undefined> {
    return this.exports.get(id);
  }

  async listExports(filter: { studyId?: string; status?: ExportStatus }): Promise<DatasetExport[]> {
    return [...this.exports.values()].filter(
      (e) =>
        (filter.studyId === undefined || e.studyId === filter.studyId) &&
        (filter.status === undefined || e.status === filter.status),
    );
  }

  async decideExport(
    id: string,
    input: { status: 'approved' | 'denied'; decisionBy: string; note?: string; decidedAt: Date },
  ): Promise<void> {
    const e = this.exports.get(id);
    if (e !== undefined) {
      e.status = input.status;
      e.decisionBy = input.decisionBy;
      if (input.note !== undefined) e.decisionNote = input.note;
    }
  }

  async markExported(id: string, rowCount: number, exportedAt: Date): Promise<void> {
    const e = this.exports.get(id);
    if (e !== undefined) {
      e.status = 'exported';
      e.rowCount = rowCount;
      e.exportedAt = exportedAt.toISOString();
    }
  }

  async revokeExport(id: string, note: string, revokedAt: Date): Promise<void> {
    const e = this.exports.get(id);
    if (e !== undefined) {
      e.status = 'revoked';
      e.decisionNote = note;
      e.revokedAt = revokedAt.toISOString();
    }
  }

  async ensureSubjectLinks(studyId: string, patientIds: string[]): Promise<SubjectLink[]> {
    const out: SubjectLink[] = [];
    for (const patientId of patientIds) {
      let link = this.links.find((l) => l.studyId === studyId && l.patientId === patientId);
      if (link === undefined) {
        link = {
          id: this.nextId(),
          studyId,
          patientId,
          pseudonym: `PSN-${this.seq.toString(16).toUpperCase().padStart(12, '0')}`,
        };
        this.links.push(link);
      }
      out.push(link);
    }
    return out;
  }

  async listSubjectLinks(studyId: string): Promise<SubjectLink[]> {
    return this.links.filter((l) => l.studyId === studyId);
  }
}

function fakePatient(id: string, facilityId: string): PatientSummary {
  return {
    id,
    facilityId,
    identifiers: [],
  } as unknown as PatientSummary;
}

function makeService(options?: { patients?: Map<string, PatientSummary> }) {
  const research = new FakeResearchRepo();
  const patients = options?.patients ?? new Map<string, PatientSummary>([
    [PATIENT_A, fakePatient(PATIENT_A, FACILITY)],
    [PATIENT_B, fakePatient(PATIENT_B, FACILITY)],
  ]);
  const published: string[] = [];
  const outbox = new OutboxService();
  const original = outbox.publish.bind(outbox);
  outbox.publish = async (input) => {
    published.push(input.type);
    return original(input);
  };
  const service = new ResearchService(
    research,
    { findById: async (id: string) => patients.get(id) } as never,
    outbox,
  );
  return { service, research, published };
}

async function approvedStudyWithCohort() {
  const ctx = makeService();
  const study = await ctx.service.createStudy({
    facilityId: FACILITY,
    code: 'STUDY-1',
    title: 'Hypertension outcomes',
    description: 'Retrospective cohort',
  });
  await ctx.service.approveStudy({ id: study.id, approver: 'Dr IRB Chair' });
  const cohort = await ctx.service.createCohort({
    studyId: study.id,
    name: 'adults-2024',
    criteria: 'age>=18 and diagnosis=I10',
  });
  await ctx.service.approveCohort({ id: cohort.id });
  return { ...ctx, study, cohort };
}

describe('ResearchService', () => {
  it('rejects duplicate study codes and publishes study_created', async () => {
    const { service, research, published } = makeService();
    const study = await service.createStudy({
      facilityId: FACILITY,
      code: 'DUP-1',
      title: 'First',
      description: '',
    });
    expect(research.studies.get(study.id)?.status).toBe('draft');
    expect(published).toContain('res.study_created');
    await expect(
      service.createStudy({ facilityId: FACILITY, code: 'DUP-1', title: 'Second', description: '' }),
    ).rejects.toThrow(ConflictException);
  });

  it('enforces study approval and close state machines', async () => {
    const { service, published } = makeService();
    const study = await service.createStudy({
      facilityId: FACILITY,
      code: 'STUDY-2',
      title: 'Sepsis markers',
      description: '',
    });
    await expect(service.closeStudy({ id: study.id, actor: 'x', reason: 'too early' })).rejects.toThrow(ConflictException);
    await service.approveStudy({ id: study.id, approver: 'Dr IRB' });
    expect(published).toContain('res.study_approved');
    await expect(service.approveStudy({ id: study.id, approver: 'Dr IRB' })).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.closeStudy({ id: study.id, actor: 'Dr IRB', reason: 'ab' }),
    ).rejects.toThrow(BadRequestException);
    await service.closeStudy({ id: study.id, actor: 'Dr IRB', reason: 'completed follow-up' });
    expect(published).toContain('res.study_closed');
    await expect(
      service.createCohort({ studyId: study.id, name: 'late', criteria: 'anything-long' }),
    ).rejects.toThrow(ConflictException);
  });

  it('versions cohorts and gates cohort approval on study approval', async () => {
    const { service, research } = makeService();
    const study = await service.createStudy({
      facilityId: FACILITY,
      code: 'STUDY-3',
      title: 'Cohort versioning',
      description: '',
    });
    const draftCohort = await service.createCohort({
      studyId: study.id,
      name: 'v',
      criteria: 'criteria-string',
    });
    expect(draftCohort.version).toBe(1);
    const v2 = await service.createCohort({
      studyId: study.id,
      name: 'v',
      criteria: 'criteria-string-v2',
    });
    expect(v2.version).toBe(2);
    await expect(service.approveCohort({ id: draftCohort.id })).rejects.toThrow(ConflictException);
    await service.approveStudy({ id: study.id, approver: 'Dr IRB' });
    await service.approveCohort({ id: draftCohort.id });
    expect(research.cohorts.get(draftCohort.id)?.status).toBe('approved');
    await expect(service.approveCohort({ id: draftCohort.id })).rejects.toThrow(ConflictException);
  });

  it('guards export requests: approval chain, cohort ownership, patients', async () => {
    const { service, research } = makeService();
    const study = await service.createStudy({
      facilityId: FACILITY,
      code: 'STUDY-4',
      title: 'Export guards',
      description: '',
    });
    const cohort = await service.createCohort({
      studyId: study.id,
      name: 'c1',
      criteria: 'criteria-long',
    });
    await expect(
      service.requestExport({
        studyId: study.id,
        cohortId: cohort.id,
        requestedBy: 'analyst',
        patientIds: [PATIENT_A],
      }),
    ).rejects.toThrow(ConflictException);
    await service.approveStudy({ id: study.id, approver: 'Dr IRB' });
    await expect(
      service.requestExport({
        studyId: study.id,
        cohortId: cohort.id,
        requestedBy: 'analyst',
        patientIds: [PATIENT_A],
      }),
    ).rejects.toThrow(ConflictException);
    await service.approveCohort({ id: cohort.id });
    await expect(
      service.requestExport({
        studyId: study.id,
        cohortId: cohort.id,
        requestedBy: 'analyst',
        patientIds: [],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.requestExport({
        studyId: study.id,
        cohortId: cohort.id,
        requestedBy: 'analyst',
        patientIds: ['99999999-9999-4999-8999-999999999999'],
      }),
    ).rejects.toThrow(NotFoundException);
    const ok = await service.requestExport({
      studyId: study.id,
      cohortId: cohort.id,
      requestedBy: 'analyst',
      patientIds: [PATIENT_A, PATIENT_B, PATIENT_A],
    });
    expect(ok.patientIds).toEqual([PATIENT_A, PATIENT_B]);
    expect(research.exports.get(ok.id)?.status).toBe('requested');
  });

  it('runs the decision, generation, and revocation state machines with stable pseudonyms', async () => {
    const { service, research, published } = await approvedStudyWithCohort();
    const first = await service.requestExport({
      studyId: research.studies.keys().next().value as string,
      cohortId: research.cohorts.keys().next().value as string,
      requestedBy: 'analyst',
      patientIds: [PATIENT_A, PATIENT_B],
    });
    await expect(
      service.generateExport({ id: first.id }),
    ).rejects.toThrow(ConflictException);
    await service.decideExport({
      id: first.id,
      decision: 'approved',
      decisionBy: 'Dr IRB',
      note: 'ethics approved for year one',
    });
    expect(published).toContain('res.export_approved');
    const generated = await service.generateExport({ id: first.id });
    expect(generated.rowCount).toBe(2);
    expect(research.exports.get(first.id)?.status).toBe('exported');
    const pseudonyms = new Map(generated.subjects.map((s) => [s.patientId, s.pseudonym]));
    expect(pseudonyms.size).toBe(2);
    // Re-export: pseudonyms stay stable per study+patient.
    const second = await service.requestExport({
      studyId: first.studyId,
      cohortId: first.cohortDefinitionId,
      requestedBy: 'analyst',
      patientIds: [PATIENT_A, PATIENT_B],
    });
    await service.decideExport({
      id: second.id,
      decision: 'approved',
      decisionBy: 'Dr IRB',
      note: 'second tranche approved',
    });
    const regenerated = await service.generateExport({ id: second.id });
    expect(new Map(regenerated.subjects.map((s) => [s.patientId, s.pseudonym]))).toEqual(
      pseudonyms,
    );
    await expect(
      service.revokeExport({ id: first.id, actor: 'steward', reason: 'ab' }),
    ).rejects.toThrow(BadRequestException);
    await service.revokeExport({
      id: first.id,
      actor: 'steward',
      reason: 'consent withdrawn by patient',
    });
    expect(research.exports.get(first.id)?.status).toBe('revoked');
    expect(published).toContain('res.export_revoked');
    await expect(
      service.decideExport({
        id: first.id,
        decision: 'denied',
        decisionBy: 'Dr IRB',
        note: 'too late to deny already',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
