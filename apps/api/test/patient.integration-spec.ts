import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('patient identity (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let svc: PatientService;
  let facilityId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const repo = new KyselyPatientRepository(db);
    svc = new PatientService(repo, new OutboxService(db));
    // org + facility fixtures for patient tests
    const code = `P${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Patient Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Patient Ward', code: 'PW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('registers, finds duplicates by surname+dob, merges preserving history', async () => {
    const mrn1 = `MRN${Date.now()}`;
    const a = await svc.register({
      familyName: 'Abiodun',
      givenName: 'Ada',
      dateOfBirth: '1990-03-03',
      sex: 'F',
      facilityId,
      mrn: mrn1,
    });
    expect(a.patient.id).toBeDefined();

    const b = await svc.register({
      familyName: 'Abiodun',
      givenName: 'Adaeze',
      dateOfBirth: '1990-03-03',
      sex: 'F',
      facilityId,
      mrn: `${mrn1}-B`,
    });
    const dups = await svc.duplicates(b.patient.id, facilityId);
    expect(dups.some((d) => d.patientId === a.patient.id && d.risk === 'REVIEW')).toBe(true);

    await svc.merge({
      survivorId: a.patient.id,
      duplicateId: b.patient.id,
      reason: 'Same person, duplicate registration at reception',
    });
    const retired = await db
      .selectFrom('patient.patient')
      .select(['status'])
      .where('id', '=', b.patient.id)
      .executeTakeFirstOrThrow();
    expect(retired.status).toBe('retired-duplicate');
    const link = await db
      .selectFrom('patient.merge_link')
      .select(['survivor_id'])
      .where('duplicate_id', '=', b.patient.id)
      .executeTakeFirst();
    expect(link?.survivor_id).toBe(a.patient.id);
    // survivor still active with full history retained
    const survivor = await db
      .selectFrom('patient.patient')
      .select(['status'])
      .where('id', '=', a.patient.id)
      .executeTakeFirstOrThrow();
    expect(survivor.status).toBe('active');
  });

  it('search finds by MRN within facility', async () => {
    const mrn = `S${Date.now()}`;
    const created = await svc.register({
      familyName: 'Okafor',
      givenName: 'Chidi',
      dateOfBirth: '1985-07-07',
      sex: 'M',
      facilityId,
      mrn,
    });
    const repo = new KyselyPatientRepository(db);
    const found = await repo.search({ query: mrn, facilityId, limit: 10 });
    expect(found.some((p) => p.id === created.patient.id)).toBe(true);
  });
});
