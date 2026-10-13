import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  CohortDefinition,
  DatasetExport,
  ResearchRepository,
  Study,
  StudyStatus,
  ExportStatus,
  SubjectLink,
} from '../domain/research.repository.js';

function asStudy(row: {
  id: string;
  facility_id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  approved_by: string | null;
  approved_at: Date | null;
  closed_at: Date | null;
}): Study {
  return {
    id: row.id,
    facilityId: row.facility_id,
    code: row.code,
    title: row.title,
    description: row.description,
    status: row.status as StudyStatus,
    ...(row.approved_by !== null ? { approvedBy: row.approved_by } : {}),
    ...(row.approved_at !== null ? { approvedAt: row.approved_at.toISOString() } : {}),
    ...(row.closed_at !== null ? { closedAt: row.closed_at.toISOString() } : {}),
  };
}

function asCohort(row: {
  id: string;
  study_id: string;
  name: string;
  version: number;
  criteria: unknown;
  status: string;
}): CohortDefinition {
  return {
    id: row.id,
    studyId: row.study_id,
    name: row.name,
    version: row.version,
    criteria: typeof row.criteria === 'string' ? row.criteria : JSON.stringify(row.criteria ?? {}),
    status: row.status as CohortDefinition['status'],
  };
}

function asExport(row: {
  id: string;
  study_id: string;
  cohort_definition_id: string;
  requested_by: string;
  patient_ids: string[];
  status: string;
  row_count: number | null;
  deidentified: boolean;
  decision_by: string | null;
  decision_note: string | null;
  exported_at: Date | null;
  revoked_at: Date | null;
}): DatasetExport {
  return {
    id: row.id,
    studyId: row.study_id,
    cohortDefinitionId: row.cohort_definition_id,
    requestedBy: row.requested_by,
    patientIds: row.patient_ids,
    status: row.status as ExportStatus,
    ...(row.row_count !== null ? { rowCount: row.row_count } : {}),
    deidentified: row.deidentified,
    ...(row.decision_by !== null ? { decisionBy: row.decision_by } : {}),
    ...(row.decision_note !== null ? { decisionNote: row.decision_note } : {}),
    ...(row.exported_at !== null ? { exportedAt: row.exported_at.toISOString() } : {}),
    ...(row.revoked_at !== null ? { revokedAt: row.revoked_at.toISOString() } : {}),
  };
}

@Injectable()
export class KyselyResearchRepository implements ResearchRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createStudy(input: {
    facilityId: string;
    code: string;
    title: string;
    description: string;
  }): Promise<Study> {
    const row = await this.db
      .insertInto('res.study')
      .values({
        facility_id: input.facilityId,
        code: input.code,
        title: input.title,
        description: input.description,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asStudy(row);
  }

  async findStudyByCode(code: string): Promise<Study | undefined> {
    const row = await this.db
      .selectFrom('res.study')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();
    return row ? asStudy(row) : undefined;
  }

  async getStudy(id: string): Promise<Study | undefined> {
    const row = await this.db
      .selectFrom('res.study')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? asStudy(row) : undefined;
  }

  async listStudies(filter: { facilityId?: string; status?: StudyStatus }): Promise<Study[]> {
    let query = this.db.selectFrom('res.study').selectAll().orderBy('created_at', 'desc');
    if (filter.facilityId !== undefined) query = query.where('facility_id', '=', filter.facilityId);
    if (filter.status !== undefined) query = query.where('status', '=', filter.status);
    const rows = await query.execute();
    return rows.map(asStudy);
  }

  async approveStudy(id: string, approver: string, approvedAt: Date): Promise<void> {
    await this.db
      .updateTable('res.study')
      .set({ status: 'approved', approved_by: approver, approved_at: approvedAt })
      .where('id', '=', id)
      .execute();
  }

  async closeStudy(id: string, closedAt: Date): Promise<void> {
    await this.db
      .updateTable('res.study')
      .set({ status: 'closed', closed_at: closedAt })
      .where('id', '=', id)
      .execute();
  }

  async createCohort(input: {
    studyId: string;
    name: string;
    version: number;
    criteria: string;
  }): Promise<CohortDefinition> {
    const row = await this.db
      .insertInto('res.cohort_definition')
      .values({
        study_id: input.studyId,
        name: input.name,
        version: input.version,
        // jsonb column: wrap the governed criteria text as a JSON scalar so
        // plain-text queries round-trip; structured JSON objects also survive.
        criteria: JSON.stringify(input.criteria),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asCohort(row);
  }

  async getCohort(id: string): Promise<CohortDefinition | undefined> {
    const row = await this.db
      .selectFrom('res.cohort_definition')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? asCohort(row) : undefined;
  }

  async listCohorts(studyId: string): Promise<CohortDefinition[]> {
    const rows = await this.db
      .selectFrom('res.cohort_definition')
      .selectAll()
      .where('study_id', '=', studyId)
      .orderBy('name', 'asc')
      .orderBy('version', 'desc')
      .execute();
    return rows.map(asCohort);
  }

  async nextCohortVersion(studyId: string, name: string): Promise<number> {
    const row = await this.db
      .selectFrom('res.cohort_definition')
      .select(({ fn }) => fn.max<number>('version').as('max_version'))
      .where('study_id', '=', studyId)
      .where('name', '=', name)
      .executeTakeFirst();
    return (row?.max_version ?? 0) + 1;
  }

  async approveCohort(id: string): Promise<void> {
    await this.db
      .updateTable('res.cohort_definition')
      .set({ status: 'approved' })
      .where('id', '=', id)
      .execute();
  }

  async createExport(input: {
    studyId: string;
    cohortDefinitionId: string;
    requestedBy: string;
    patientIds: string[];
  }): Promise<DatasetExport> {
    const row = await this.db
      .insertInto('res.dataset_export')
      .values({
        study_id: input.studyId,
        cohort_definition_id: input.cohortDefinitionId,
        requested_by: input.requestedBy,
        patient_ids: input.patientIds,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return asExport(row);
  }

  async getExport(id: string): Promise<DatasetExport | undefined> {
    const row = await this.db
      .selectFrom('res.dataset_export')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? asExport(row) : undefined;
  }

  async listExports(filter: { studyId?: string; status?: ExportStatus }): Promise<DatasetExport[]> {
    let query = this.db
      .selectFrom('res.dataset_export')
      .selectAll()
      .orderBy('requested_at', 'desc');
    if (filter.studyId !== undefined) query = query.where('study_id', '=', filter.studyId);
    if (filter.status !== undefined) query = query.where('status', '=', filter.status);
    const rows = await query.execute();
    return rows.map(asExport);
  }

  async decideExport(
    id: string,
    input: { status: 'approved' | 'denied'; decisionBy: string; note?: string; decidedAt: Date },
  ): Promise<void> {
    await this.db
      .updateTable('res.dataset_export')
      .set({
        status: input.status,
        decision_by: input.decisionBy,
        decision_note: input.note ?? null,
        decided_at: input.decidedAt,
      })
      .where('id', '=', id)
      .execute();
  }

  async markExported(id: string, rowCount: number, exportedAt: Date): Promise<void> {
    await this.db
      .updateTable('res.dataset_export')
      .set({ status: 'exported', row_count: rowCount, exported_at: exportedAt })
      .where('id', '=', id)
      .execute();
  }

  async revokeExport(id: string, note: string, revokedAt: Date): Promise<void> {
    await this.db
      .updateTable('res.dataset_export')
      .set({ status: 'revoked', decision_note: note, revoked_at: revokedAt })
      .where('id', '=', id)
      .execute();
  }

  async ensureSubjectLinks(studyId: string, patientIds: string[]): Promise<SubjectLink[]> {
    const links: SubjectLink[] = [];
    for (const patientId of patientIds) {
      const existing = await this.db
        .selectFrom('res.subject_link')
        .selectAll()
        .where('study_id', '=', studyId)
        .where('patient_id', '=', patientId)
        .executeTakeFirst();
      if (existing !== undefined) {
        links.push({
          id: existing.id,
          studyId: existing.study_id,
          patientId: existing.patient_id,
          pseudonym: existing.pseudonym,
        });
        continue;
      }
      const inserted = await this.db
        .insertInto('res.subject_link')
        .values({
          study_id: studyId,
          patient_id: patientId,
          pseudonym: `PSN-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      links.push({
        id: inserted.id,
        studyId: inserted.study_id,
        patientId: inserted.patient_id,
        pseudonym: inserted.pseudonym,
      });
    }
    return links;
  }

  async listSubjectLinks(studyId: string): Promise<SubjectLink[]> {
    const rows = await this.db
      .selectFrom('res.subject_link')
      .selectAll()
      .where('study_id', '=', studyId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      studyId: row.study_id,
      patientId: row.patient_id,
      pseudonym: row.pseudonym,
    }));
  }
}
