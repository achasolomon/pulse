import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselySyncRepository } from './../src/modules/sync/infrastructure/kysely-sync.repository.js';
import { SyncService } from './../src/modules/sync/application/sync.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('edge sync (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let sync: SyncService;
  let facilityId: string;
  let patientId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    sync = new SyncService(
      new KyselySyncRepository(db),
      patientRepo,
      new KyselyEncounterRepository(db),
      new KyselyClinicalRepository(db),
      new PatientService(patientRepo, outbox),
      new EncounterService(
        new KyselyEncounterRepository(db),
        patientRepo,
        outbox,
      ),
      outbox,
    );

    const code = `Y${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Sync Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Sync Ward', code: 'SW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    patientId = (
      await patients.register({
        familyName: 'Sync', givenName: 'Pat', dateOfBirth: '1998-08-08',
        sex: 'F', facilityId, mrn: `SY${Date.now()}`,
      })
    ).patient.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('feed pages with cursors; apply is idempotent; duplicates conflict; resolve closes', async () => {
    const first = await sync.feed('', 5, 'edge-test-1');
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.cursor).toBeTruthy();

    const obs = {
      eventId: randomUUID(),
      type: 'observation.recorded',
      aggregateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { patientId, code: 'TEMP', valueNum: 37.1, unit: 'C' },
    };
    const once = await sync.apply([obs], {});
    expect(once.applied).toEqual([obs.eventId]);
    const twice = await sync.apply([obs], {});
    expect(twice.skipped).toEqual([obs.eventId]);

    // Edge re-registration of the same person conflicts instead of duplicating.
    const dup = {
      eventId: randomUUID(),
      type: 'patient.registered',
      aggregateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        familyName: 'Sync', givenName: 'Pat', dateOfBirth: '1998-08-08',
        sex: 'F', facilityId, mrn: `SY${Date.now()}-edge`,
      },
    };
    const res = await sync.apply([dup], {});
    expect(res.conflicts).toEqual([dup.eventId]);
    const open = await sync.openConflicts();
    const mine = open.find((c) => c.reason === 'DUPLICATE_PATIENT');
    expect(mine).toBeDefined();
    await sync.resolveConflict(mine?.id ?? '', 'Merged manually at facility desk');
    const after = await sync.openConflicts();
    expect(after.some((c) => c.id === mine?.id)).toBe(false);
  });
});
