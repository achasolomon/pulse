import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyResearchRepository } from './../src/modules/research/infrastructure/kysely-research.repository.js';
import { ResearchService } from './../src/modules/research/application/research.service.js';
import type { PatientRepository } from './../src/modules/patient/domain/patient.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

describe.skipIf(!hasDb)('Research governance (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let research: ResearchService;
  let facilityId: string;
  let patA: string;
  let patB: string;
  let patAnnex: string;
  let studyId: string;
  let cohortId: string;
  let exportId: string;
  const RUN = `R${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    research = new ResearchService(
      new KyselyResearchRepository(db),
      {
        findById: async (id: string) => {
          const r = await db
            .selectFrom('patient.patient')
            .select(['id', 'facility_id'])
            .where('id', '=', id)
            .executeTakeFirst();
          return r ? { id: r.id, facilityId: r.facility_id } : undefined;
        },
      } as unknown as PatientRepository,
      new OutboxService(db),
    );

    const org = await db
      .insertInto('org.organization')
      .values({ name: `Res Org ${RUN}`, code: RUN.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Main', code: `M${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const annex = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Annex', code: `A${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const mkPatient = async (facId: string, family: string) => {
      const r = await db
        .insertInto('patient.patient')
        .values({
          facility_id: facId,
          family_name: `${family}${RUN}`,
          given_name: 'Pat',
          date_of_birth: '1980-01-01',
          sex: 'F',
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return r.id;
    };
    patA = await mkPatient(facilityId, 'ResA');
    patB = await mkPatient(facilityId, 'ResB');
    patAnnex = await mkPatient(annex.id, 'ResX');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('runs the full approval chain, export controls, and de-identification vault', async () => {
    const study = await research.createStudy({
      facilityId,
      code: `S${RUN}`.slice(0, 12),
      title: `Hypertension ${RUN}`,
      description: 'retrospective outcomes',
    });
    studyId = study.id;
    expect(study.status).toBe('draft');
    await expectCode(
      research.createStudy({ facilityId, code: study.code, title: 'dup', description: '' }),
      'STUDY_CODE_EXISTS',
      409,
    );

    const cohort = await research.createCohort({
      studyId,
      name: 'adults',
      criteria: 'age>=18 and dx=I10',
    });
    cohortId = cohort.id;
    expect(cohort.version).toBe(1);
    const v2 = await research.createCohort({
      studyId,
      name: 'adults',
      criteria: 'age>=18 and dx=I10 and year=2025',
    });
    expect(v2.version).toBe(2);

    // Pre-approval gates.
    await expectCode(research.approveCohort({ id: cohortId }), 'STUDY_NOT_APPROVED', 409);
    await expectCode(
      research.requestExport({ studyId, cohortId, requestedBy: 'analyst', patientIds: [patA] }),
      'STUDY_NOT_APPROVED',
      409,
    );

    await research.approveStudy({ id: studyId, approver: `Dr IRB ${RUN}` });
    await expectCode(
      research.approveStudy({ id: studyId, approver: `Dr IRB ${RUN}` }),
      'STUDY_STATE_INVALID',
      409,
    );
    await research.approveCohort({ id: cohortId });
    await expectCode(research.approveCohort({ id: cohortId }), 'COHORT_STATE_INVALID', 409);

    // Export request guards.
    await expectCode(
      research.requestExport({ studyId, cohortId, requestedBy: 'analyst', patientIds: [] }),
      'EXPORT_PATIENTS_REQUIRED',
      400,
    );
    await expectCode(
      research.requestExport({
        studyId,
        cohortId,
        requestedBy: 'analyst',
        patientIds: ['99999999-9999-4999-8999-999999999999'],
      }),
      'PATIENT_NOT_FOUND',
      404,
    );
    await expectCode(
      research.requestExport({
        studyId,
        cohortId,
        requestedBy: 'analyst',
        patientIds: [patAnnex],
      }),
      'PATIENT_FACILITY_MISMATCH',
      409,
    );

    // Denied path.
    const denied = await research.requestExport({
      studyId,
      cohortId,
      requestedBy: 'analyst',
      patientIds: [patA],
    });
    await expectCode(
      research.decideExport({
        id: denied.id,
        decision: 'denied',
        decisionBy: `Dr IRB ${RUN}`,
        note: 'ab',
      }),
      'REASON_TOO_SHORT',
      400,
    );
    await research.decideExport({
      id: denied.id,
      decision: 'denied',
      decisionBy: `Dr IRB ${RUN}`,
      note: 'insufficient justification for tranche one',
    });
    expect((await research.getExportById(denied.id)).status).toBe('denied');
    await expectCode(
      research.decideExport({
        id: denied.id,
        decision: 'approved',
        decisionBy: `Dr IRB ${RUN}`,
        note: 'changing our minds',
      }),
      'EXPORT_STATE_INVALID',
      409,
    );

    // Approved + generated path with stable pseudonyms.
    const ok = await research.requestExport({
      studyId,
      cohortId,
      requestedBy: 'analyst',
      patientIds: [patA, patB, patA],
    });
    exportId = ok.id;
    expect(ok.patientIds).toEqual([patA, patB]);
    await expectCode(research.generateExport({ id: exportId }), 'EXPORT_STATE_INVALID', 409);
    await research.decideExport({
      id: exportId,
      decision: 'approved',
      decisionBy: `Dr IRB ${RUN}`,
      note: 'ethics approved for year one of the study',
    });
    const generated = await research.generateExport({ id: exportId });
    expect(generated.rowCount).toBe(2);
    const byPatient = new Map(generated.subjects.map((s) => [s.patientId, s.pseudonym]));
    expect(byPatient.size).toBe(2);
    expect((await research.getExportById(exportId)).status).toBe('exported');

    // Re-export keeps the same pseudonyms (vault stability).
    const again = await research.requestExport({
      studyId,
      cohortId,
      requestedBy: 'analyst',
      patientIds: [patA, patB],
    });
    await research.decideExport({
      id: again.id,
      decision: 'approved',
      decisionBy: `Dr IRB ${RUN}`,
      note: 'second tranche approved under the same protocol',
    });
    const regenerated = await research.generateExport({ id: again.id });
    expect(new Map(regenerated.subjects.map((s) => [s.patientId, s.pseudonym]))).toEqual(byPatient);

    // Revocation.
    await expectCode(
      research.revokeExport({ id: exportId, actor: 'steward', reason: 'ab' }),
      'REASON_TOO_SHORT',
      400,
    );
    await research.revokeExport({
      id: exportId,
      actor: 'steward',
      reason: `consent withdrawn by patient ${RUN}`,
    });
    expect((await research.getExportById(exportId)).status).toBe('revoked');
    await expectCode(
      research.decideExport({
        id: exportId,
        decision: 'approved',
        decisionBy: `Dr IRB ${RUN}`,
        note: 'cannot decide a revoked export',
      }),
      'EXPORT_STATE_INVALID',
      409,
    );

    // Study close + closed-study cohort guard.
    await expectCode(
      research.closeStudy({ id: studyId, actor: 'steward', reason: 'ab' }),
      'REASON_TOO_SHORT',
      400,
    );
    await research.closeStudy({ id: studyId, actor: 'steward', reason: 'protocol completed' });
    expect((await research.getStudy(studyId)).status).toBe('closed');
    await expectCode(
      research.createCohort({ studyId, name: 'late', criteria: 'too late for this study' }),
      'STUDY_STATE_INVALID',
      409,
    );

    const vault = await research.listSubjects(studyId);
    expect(vault).toHaveLength(2);
    expect(new Set(vault.map((s) => s.patientId))).toEqual(new Set([patA, patB]));
  });

  it('persists the outbox chain and enforces the DB pseudonym backstop', async () => {
    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('type', 'like', 'res.%')
      .where('aggregate_id', 'in', [studyId, cohortId, exportId])
      .execute();
    const types = new Set(events.map((e) => e.type));
    for (const t of [
      'res.study_created',
      'res.study_approved',
      'res.cohort_created',
      'res.cohort_approved',
      'res.export_requested',
      'res.export_approved',
      'res.export_generated',
      'res.export_revoked',
      'res.study_closed',
    ]) {
      expect(types.has(t)).toBe(true);
    }

    // DB backstop: the same patient cannot get a second pseudonym per study.
    await expect(
      db
        .insertInto('res.subject_link')
        .values({ study_id: studyId, patient_id: patA, pseudonym: `PSN-DUP${RUN}` })
        .execute(),
    ).rejects.toThrow(/subject_patient_unique/);
  });
});
