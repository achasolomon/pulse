import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyImagingRepository } from './../src/modules/imaging/infrastructure/kysely-imaging.repository.js';
import { ImagingService } from './../src/modules/imaging/application/imaging.service.js';
import { KyselyMedicationRepository } from './../src/modules/medication/infrastructure/kysely-medication.repository.js';
import { MedicationService } from './../src/modules/medication/application/medication.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('imaging + medication chains (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let imaging: ImagingService;
  let meds: MedicationService;
  let patientId: string;
  let encounterId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    imaging = new ImagingService(new KyselyImagingRepository(db), outbox);
    meds = new MedicationService(new KyselyMedicationRepository(db), outbox);

    const code = `D${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Diag Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Diagnostics', code: 'DG' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Diag',
      givenName: 'Pat',
      dateOfBirth: '1991-01-01',
      sex: 'F',
      facilityId: fac.id,
      mrn: `DG${Date.now()}`,
    });
    patientId = reg.patient.id;
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const enc = await encounters.open({ patientId, facilityId: fac.id, type: 'outpatient' });
    encounterId = enc.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('imaging order -> final with PACS ref, amend versions', async () => {
    const order = await imaging.placeOrder({
      patientId,
      encounterId,
      procedureCode: 'CT-ABD',
      bodyRegion: 'abdomen',
      indication: 'Pain',
      urgency: 'urgent',
    });
    await imaging.schedule(order.id, {});
    await imaging.protocol(order.id, {});
    await imaging.acquire(order.id, {
      studyUid: `1.2.3.${Date.now()}`,
      accession: 'ACC-1',
      modality: 'CT',
      pacsRef: 'pacs://studies/1.2.3',
    }, {});
    await imaging.report(order.id, { text: 'Findings v1' });
    // amendment before finalize -> version 2
    await imaging.report(order.id, { text: 'Findings v2 - addendum' });
    await imaging.finalize(order.id, {});
    const versions = await db
      .selectFrom('img.report')
      .select(['version', 'status'])
      .where('order_id', '=', order.id)
      .orderBy('version')
      .execute();
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const studies = await db
      .selectFrom('img.study')
      .select(['study_uid', 'pacs_ref'])
      .where('order_id', '=', order.id)
      .execute();
    expect(studies[0]?.pacs_ref).toContain('pacs://');
  });

  it('prescribe -> verify -> dispense -> given + held/not-given accounted', async () => {
    await meds.defineMedication({
      code: 'AMOX-500',
      name: 'Amoxicillin',
      doseForm: 'capsule',
      strength: '500mg',
      route: 'oral',
    });
    const req = await meds.prescribe({
      patientId,
      encounterId,
      medicationCode: 'AMOX-500',
      dose: '500mg',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
    });
    await meds.verify(req.id, {});
    await meds.dispense(req.id, { quantity: '20 capsules', batch: 'B-100' });
    await meds.administer(req.id, { doseGiven: '500mg', outcome: 'given', reason: '' });
    await meds.administer(req.id, { doseGiven: '', outcome: 'not-given', reason: 'Vomited dose' });
    const admins = await db
      .selectFrom('med.administration')
      .select(['outcome'])
      .where('request_id', '=', req.id)
      .execute();
    expect(admins.map((a) => a.outcome).sort()).toEqual(['given', 'not-given']);
    await meds.hold(req.id, { reason: 'Rash suspected' });
    const held = await db
      .selectFrom('med.request')
      .select(['status'])
      .where('id', '=', req.id)
      .executeTakeFirstOrThrow();
    expect(held.status).toBe('held');
  });
});
