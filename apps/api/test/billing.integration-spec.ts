import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { RevenueService } from './../src/modules/revenue/application/revenue.service.js';
import { BillingProjector } from './../src/modules/revenue/application/billing-projector.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyAppointmentRepository } from './../src/modules/scheduling/infrastructure/kysely-appointment.repository.js';
import { SchedulingService } from './../src/modules/scheduling/application/scheduling.service.js';
import { KyselyLabRepository } from './../src/modules/laboratory/infrastructure/kysely-lab.repository.js';
import { LaboratoryService } from './../src/modules/laboratory/application/laboratory.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('auto-charge projection (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let projector: BillingProjector;
  let patientId: string;
  let encounterId: string;
  let facilityId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    projector = new BillingProjector(new KyselyRevenueRepository(db), outbox);

    const code = `J${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Auto Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Auto Ward', code: 'AW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    patientId = (
      await patients.register({
        familyName: 'Auto', givenName: 'Pat', dateOfBirth: '1994-04-04',
        sex: 'F', facilityId, mrn: `AU${Date.now()}`,
      })
    ).patient.id;
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    encounterId = (await encounters.open({ patientId, facilityId, type: 'outpatient' })).id;

    // Rules: lab by payload testCode, appointment fixed CONSULT.
    const revenue = new RevenueService(new KyselyRevenueRepository(db), outbox);
    await revenue.defineService({ code: 'FBC', name: 'Full Blood Count', defaultPrice: 3500 });
    await revenue.defineService({ code: 'CONSULT', name: 'Consultation', defaultPrice: 5000 });
    await revenue.defineRule({ eventType: 'lab.ordered', codeField: 'testCode', quantity: 1 });
    await revenue.defineRule({ eventType: 'appointment.booked', serviceCode: 'CONSULT', quantity: 1 });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('projects lab + appointment charges once; re-run is a no-op', async () => {
    const outbox = new OutboxService(db);
    const lab = new LaboratoryService(new KyselyLabRepository(db), outbox);
    await lab.defineTest({ code: 'FBC', name: 'Full Blood Count', specimenRequirement: 'EDTA' });
    await lab.placeOrder({
      patientId, encounterId, testCode: 'FBC', urgency: 'routine', indication: 'screen',
    });
    const scheduling = new SchedulingService(
      new KyselyAppointmentRepository(db),
      outbox,
    );
    await scheduling.book({
      patientId, facilityId, scheduledAt: new Date().toISOString(), reason: 'Follow-up',
    });

    const first = await projector.project({});
    // Other suites emit billable events into the shared outbox, so the run
    // total is global — but THIS patient's charges must be exactly ours.
    expect(first.projected).toBeGreaterThanOrEqual(2);
    const charges = await db
      .selectFrom('rev.charge')
      .select(['service_code', 'source_event_id'])
      .where('patient_id', '=', patientId)
      .execute();
    expect(charges.map((c) => c.service_code).sort()).toEqual(['CONSULT', 'FBC']);
    expect(charges.every((c) => c.source_event_id)).toBe(true);

    const second = await projector.project({});
    expect(second.projected).toBeGreaterThanOrEqual(0);
    const recount = await db
      .selectFrom('rev.charge')
      .select(['id'])
      .where('patient_id', '=', patientId)
      .execute();
    expect(recount).toHaveLength(2);
  });
});
