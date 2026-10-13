import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyTheatreRepository } from './../src/modules/theatre/infrastructure/kysely-theatre.repository.js';
import { TheatreService } from './../src/modules/theatre/application/theatre.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('theatre case (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let theatre: TheatreService;
  let facilityId: string;
  let encounterId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    theatre = new TheatreService(new KyselyTheatreRepository(db), outbox);

    const code = `T${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Theatre Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Theatre Block', code: 'TH' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Theatre', givenName: 'Pat', dateOfBirth: '1993-03-03',
      sex: 'F', facilityId, mrn: `TH${Date.now()}`,
    });
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    encounterId = (
      await encounters.open({ patientId: reg.patient.id, facilityId, type: 'inpatient' })
    ).id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('book -> check-in -> start -> ordered checklist -> record -> complete', async () => {
    const suite = await theatre.defineSuite(facilityId, 'Theatre 1', 'TH1');
    const booking = await theatre.book({
      encounterId,
      suiteId: suite.id,
      procedureName: 'Appendectomy',
      urgency: 'urgent',
      scheduledAt: new Date().toISOString(),
    });
    await theatre.checkIn(booking.id, {});
    await theatre.start(booking.id, {});

    // Out-of-order checklist is refused.
    await expect(
      theatre.checklist(booking.id, 'time-out', [{ item: 'consent' }]),
    ).rejects.toThrow('strictly in order');
    await theatre.checklist(booking.id, 'sign-in', [{ item: 'identity' }]);
    await theatre.checklist(booking.id, 'time-out', [{ item: 'consent' }]);
    // Completion still refused before sign-out.
    await expect(theatre.complete(booking.id, {})).rejects.toThrow('before the case can close');
    await theatre.checklist(booking.id, 'sign-out', [{ item: 'counts' }]);

    await theatre.record(booking.id, {
      surgeon: 'Dr. Rao',
      anesthetist: 'Dr. Bello',
      notes: 'Uncomplicated.',
    });
    const done = await theatre.complete(booking.id, {});
    expect(done.status).toBe('completed');
  });
});
