import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyReportsRepository } from './../src/modules/reports/infrastructure/kysely-reports.repository.js';
import { ReportsService } from './../src/modules/reports/application/reports.service.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { ClinicalService } from './../src/modules/clinical/application/clinical.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyWorkflowRepository } from './../src/modules/workflow/infrastructure/kysely-workflow.repository.js';
import { WorkflowService } from './../src/modules/workflow/application/workflow.service.js';
import { KyselyDocumentRepository } from './../src/modules/documents/infrastructure/kysely-document.repository.js';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { RevenueService } from './../src/modules/revenue/application/revenue.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('handover, export, reports (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let facilityId: string;
  let patientId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    const encounterRepo = new KyselyEncounterRepository(db);
    const patients = new PatientService(patientRepo, outbox);
    const encounters = new EncounterService(encounterRepo, patientRepo, outbox);
    const clinical = new ClinicalService(
      new KyselyClinicalRepository(db),
      outbox,
      encounterRepo,
      patientRepo,
      new KyselyWorkflowRepository(db),
      new KyselyDocumentRepository(db),
    );
    const workflow = new WorkflowService(new KyselyWorkflowRepository(db), outbox);

    const code = `G${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Gap Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Gap Ward', code: 'GW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const reg = await patients.register({
      familyName: 'Gap',
      givenName: 'Pat',
      dateOfBirth: '1996-06-06',
      sex: 'F',
      facilityId,
      mrn: `GP${Date.now()}`,
    });
    patientId = reg.patient.id;
    const enc = await encounters.open({ patientId, facilityId, type: 'inpatient' });
    await encounters.admit(enc.id, { departmentId: (await db
      .insertInto('org.department')
      .values({ facility_id: facilityId, name: 'Ward', code: 'WD' })
      .returning(['id'])
      .executeTakeFirstOrThrow()).id, bed: 'W-1' });
    await clinical.recordEntry({ patientId, encounterId: enc.id, kind: 'problem', display: 'Asthma' });
    await clinical.recordEntry({ patientId, encounterId: enc.id, kind: 'allergy', display: 'Sulfa' });
    await workflow.createTask({ kind: 'review-result', patientId, facilityId });
    const revenue = new RevenueService(new KyselyRevenueRepository(db), outbox);
    await revenue.defineService({ code: 'BED-DAY', name: 'Bed day', defaultPrice: 20000 });
    const charge = await revenue.captureCharge({ patientId, encounterId: enc.id, serviceCode: 'BED-DAY', quantity: 1 });
    const invoice = await revenue.invoice({ patientId, chargeIds: [charge.id] });
    await revenue.pay(invoice.id, { amount: 20000, method: 'cash' });
    const claim = await revenue.fileClaim(invoice.id, 'Cash', {});
    await revenue.submitClaim(claim.id, {});
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('handover reflects census, problems, allergies, tasks', async () => {
    const clinical = new ClinicalService(
      new KyselyClinicalRepository(db),
      new OutboxService(db),
      new KyselyEncounterRepository(db),
      new KyselyPatientRepository(db),
      new KyselyWorkflowRepository(db),
      new KyselyDocumentRepository(db),
    );
    const h = await clinical.handover(facilityId);
    expect(h.census).toBe(1);
    expect(h.items[0]?.problems).toContain('Asthma');
    expect(h.items[0]?.allergies).toContain('Sulfa');
    expect(h.openTasks.length).toBeGreaterThanOrEqual(1);
  });

  it('export bundle + reports reflect seeded data', async () => {
    const clinical = new ClinicalService(
      new KyselyClinicalRepository(db),
      new OutboxService(db),
      new KyselyEncounterRepository(db),
      new KyselyPatientRepository(db),
      new KyselyWorkflowRepository(db),
      new KyselyDocumentRepository(db),
    );
    const bundle = await clinical.exportBundle(patientId);
    expect(bundle.patient?.id).toBe(patientId);
    expect(bundle.problems.map((p) => p.display)).toContain('Asthma');

    const reports = new ReportsService(new KyselyReportsRepository(db));
    const census = await reports.census(facilityId);
    expect(census.reduce((s, r) => s + r.count, 0)).toBe(1);
    const revenue = await reports.revenue(facilityId, '2024-01-01', '2027-01-01');
    expect(revenue.charges).toBe(20000);
    expect(revenue.paid).toBe(20000);
    expect(revenue.outstanding).toBe(0);
    const claims = await reports.claims(facilityId);
    expect(claims.some((c) => c.status === 'submitted')).toBe(true);
  });
});
