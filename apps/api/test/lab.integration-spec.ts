import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyLabRepository } from './../src/modules/laboratory/infrastructure/kysely-lab.repository.js';
import { LaboratoryService } from './../src/modules/laboratory/application/laboratory.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('laboratory order-to-verified (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let lab: LaboratoryService;
  let patientId: string;
  let encounterId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    lab = new LaboratoryService(new KyselyLabRepository(db), outbox);

    const code = `L${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Lab Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Lab', code: 'LB' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Lab',
      givenName: 'Pat',
      dateOfBirth: '1992-02-02',
      sex: 'F',
      facilityId: fac.id,
      mrn: `LB${Date.now()}`,
    });
    patientId = reg.patient.id;
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const enc = await encounters.open({ patientId, facilityId: fac.id, type: 'outpatient' });
    encounterId = enc.id;
    await lab.defineTest({ code: 'FBC', name: 'Full Blood Count', specimenRequirement: 'EDTA' });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('order -> collect -> accession -> critical result -> ack -> verify; amend versions', async () => {
    const order = await lab.placeOrder({
      patientId,
      encounterId,
      testCode: 'FBC',
      urgency: 'urgent',
      indication: 'Anaemia workup',
    });
    expect(order.status).toBe('ordered');

    await lab.collect(order.id, { container: 'EDTA', label: 'LBL-001' });
    await lab.accession(order.id, {});
    const res = await lab.result(order.id, {
      component: 'Hb',
      valueText: '5.1',
      unit: 'g/dL',
      flag: 'critical',
    });
    expect(res.critical).toBe(true);
    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_id', '=', order.id)
      .execute();
    expect(events.map((e) => e.type)).toContain('lab.critical_result');

    await lab.acknowledgeCritical(order.id, { ackBy: '11111111-1111-1111-1111-111111111111' });
    // amendment creates a new result version, original retained
    await lab.result(order.id, {
      component: 'Hb',
      valueText: '5.2',
      unit: 'g/dL',
      flag: 'critical',
    });
    const versions = await db
      .selectFrom('lab.result')
      .select(['version'])
      .where('order_id', '=', order.id)
      .where('component', '=', 'Hb')
      .orderBy('version')
      .execute();
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    const verified = await lab.verify(order.id, {
      verifiedBy: '11111111-1111-1111-1111-111111111111',
    });
    expect(verified.status).toBe('verified');
  });
});
