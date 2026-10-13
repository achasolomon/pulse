/**
 * Research governance domain (EPIC-25 final slice). BACKLOG-001: cohort/query
 * governance, de-identification/pseudonymization, approvals, export controls,
 * provenance. IAM-001: research is an approved purpose of use; access uses
 * approved data scope + de-identification. This module governs the *process* —
 * it does not execute cohort queries (EPIC-20) or store IRB documents.
 */

export type StudyStatus = 'draft' | 'approved' | 'closed';
export type CohortStatus = 'draft' | 'approved';
export type ExportStatus = 'requested' | 'approved' | 'denied' | 'exported' | 'revoked';

export interface Study {
  id: string;
  facilityId: string;
  code: string;
  title: string;
  description: string;
  status: StudyStatus;
  approvedBy?: string;
  approvedAt?: string;
  closedAt?: string;
}

export interface CohortDefinition {
  id: string;
  studyId: string;
  name: string;
  version: number;
  criteria: string;
  status: CohortStatus;
}

export interface DatasetExport {
  id: string;
  studyId: string;
  cohortDefinitionId: string;
  requestedBy: string;
  patientIds: string[];
  status: ExportStatus;
  rowCount?: number;
  deidentified: boolean;
  decisionBy?: string;
  decisionNote?: string;
  exportedAt?: string;
  revokedAt?: string;
}

export interface SubjectLink {
  id: string;
  studyId: string;
  patientId: string;
  pseudonym: string;
}

export const RESEARCH_REPOSITORY = 'RESEARCH_REPOSITORY';

export interface ResearchRepository {
  createStudy(input: {
    facilityId: string;
    code: string;
    title: string;
    description: string;
  }): Promise<Study>;
  findStudyByCode(code: string): Promise<Study | undefined>;
  getStudy(id: string): Promise<Study | undefined>;
  listStudies(filter: { facilityId?: string; status?: StudyStatus }): Promise<Study[]>;
  approveStudy(id: string, approver: string, approvedAt: Date): Promise<void>;
  closeStudy(id: string, closedAt: Date): Promise<void>;
  createCohort(input: {
    studyId: string;
    name: string;
    version: number;
    criteria: string;
  }): Promise<CohortDefinition>;
  getCohort(id: string): Promise<CohortDefinition | undefined>;
  listCohorts(studyId: string): Promise<CohortDefinition[]>;
  nextCohortVersion(studyId: string, name: string): Promise<number>;
  approveCohort(id: string): Promise<void>;
  createExport(input: {
    studyId: string;
    cohortDefinitionId: string;
    requestedBy: string;
    patientIds: string[];
  }): Promise<DatasetExport>;
  getExport(id: string): Promise<DatasetExport | undefined>;
  listExports(filter: { studyId?: string; status?: ExportStatus }): Promise<DatasetExport[]>;
  decideExport(
    id: string,
    input: { status: 'approved' | 'denied'; decisionBy: string; note?: string; decidedAt: Date },
  ): Promise<void>;
  markExported(id: string, rowCount: number, exportedAt: Date): Promise<void>;
  revokeExport(id: string, note: string, revokedAt: Date): Promise<void>;
  /** Stable per-study pseudonyms: existing links are kept on re-export. */
  ensureSubjectLinks(studyId: string, patientIds: string[]): Promise<SubjectLink[]>;
  listSubjectLinks(studyId: string): Promise<SubjectLink[]>;
}
