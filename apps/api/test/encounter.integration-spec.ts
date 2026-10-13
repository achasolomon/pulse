import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('encounter lifecycle (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let encounters: EncounterService;
  let facilityId: string;
  let patientId: string;
  let departmentId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    const patients = new PatientService(patientRepo, outbox);
    encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const code = `E${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Enc Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'ED', code: 'ED' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const dept = await db
      .insertInto('org.department')
      .values({ facility_id: fac.id, name: 'Emergency', code: 'EMG' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    departmentId = dept.id;
    const reg = await patients.register({
      familyName: 'Mensah',
      givenName: 'Kofi',
      dateOfBirth: '1975-12-12',
      sex: 'M',
      facilityId,
      mrn: `EM${Date.now()}`,
    });
    patientId = reg.patient.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('open -> admit -> transfer -> discharge with history + outbox', async () => {
    const enc = await encounters.open({ patientId, facilityId, type: 'inpatient' });
    expect(enc.status).toBe('open');

    const admitted = await encounters.admit(enc.id, { departmentId, bed: 'A-01' });
    expect(admitted.status).toBe('admitted');

    const dept2 = await db
      .insertInto('org.department')
      .values({ facility_id: facilityId, name: 'Ward', code: 'WRD' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const transferred = await encounters.transfer(enc.id, {
      departmentId: dept2.id,
      bed: 'W-02',
    });
    expect(transferred.status).toBe('admitted');

    const discharged = await encounters.discharge(enc.id, { disposition: 'home' });
    expect(discharged.status).toBe('discharged');

    const history = await new KyselyEncounterRepository(db).listHistory(enc.id);
    expect(history.map((h) => h.action)).toEqual(['admit', 'transfer', 'discharge']);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_id', '=', enc.id)
      .execute();
    expect(events.map((e) => e.type).sort()).toEqual(
      ['encounter.admitted', 'encounter.discharged', 'encounter.opened', 'encounter.transferred'].sort(),
    );
  });

  it('rejects discharge-then-act and inpatient direct discharge', async () => {
    const enc = await encounters.open({ patientId, facilityId, type: 'inpatient' });
    await expect(encounters.discharge(enc.id, {})).rejects.toThrow(
      'Illegal transition',
    );
    await encounters.cancel(enc.id, {});
    await expect(
      encounters.admit(enc.id, { departmentId }),
    ).rejects.toThrow('Illegal transition');
  });
});
