import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyEmergencyRepository } from './../src/modules/emergency/infrastructure/kysely-emergency.repository.js';
import { EmergencyService } from './../src/modules/emergency/application/emergency.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('emergency visit (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let emergency: EmergencyService;
  let facilityId: string;
  let patientId: string;
  let encounterId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    const encounterRepo = new KyselyEncounterRepository(db);
    emergency = new EmergencyService(
      new KyselyEmergencyRepository(db),
      encounterRepo,
      new EncounterService(encounterRepo, patientRepo, outbox),
      outbox,
    );

    const code = `G${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Emg Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'ED', code: 'ED' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    patientId = (
      await patients.register({
        familyName: 'Emg', givenName: 'Pat', dateOfBirth: '1999-09-09',
        sex: 'M', facilityId, mrn: `EG${Date.now()}`,
      })
    ).patient.id;
    const encounters = new EncounterService(encounterRepo, patientRepo, outbox);
    encounterId = (await encounters.open({ patientId, facilityId, type: 'emergency' })).id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('arrive -> score -> ordered waiting list -> guarded disposition', async () => {
    await expect(emergency.dischargeWithAcuity(encounterId, {})).rejects.toThrow(
      'before disposition',
    );
    await emergency.score({
      encounterId,
      level: 2,
      discriminator: 'Chest pain, diaphoretic',
    });
    // A second, less urgent arrival sorts after.
    const patients = new PatientService(new KyselyPatientRepository(db), new OutboxService(db));
    const other = await patients.register({
      familyName: 'Emg2', givenName: 'Pat', dateOfBirth: '1990-01-01',
      sex: 'F', facilityId, mrn: `EG2${Date.now()}`,
    });
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      new KyselyPatientRepository(db),
      new OutboxService(db),
    );
    const otherEnc = await encounters.open({ patientId: other.patient.id, facilityId, type: 'emergency' });
    await emergency.score({ encounterId: otherEnc.id, level: 4, discriminator: 'Sprained ankle' });

    const waiting = await emergency.waiting(facilityId);
    expect(waiting.entries.map((e) => e.encounterId)).toEqual([encounterId, otherEnc.id]);
    expect(waiting.entries[0]?.waitingMinutes).toBeGreaterThanOrEqual(0);

    const done = await emergency.dischargeWithAcuity(encounterId, { disposition: 'admitted' });
    expect(done.status).toBe('discharged');
  });
});
