import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { FhirService } from './../src/modules/fhir/application/fhir.service.js';
import {
  KyselyPartnerRepository,
  hashApiKey,
} from './../src/modules/fhir/infrastructure/partner.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('FHIR read gateway (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let fhir: FhirService;
  let patientId: string;
  let partnerId: string;
  let mrn: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patients = new KyselyPatientRepository(db);
    fhir = new FhirService(
      patients,
      new KyselyEncounterRepository(db),
      new KyselyPartnerRepository(db),
      db,
    );

    const code = `H${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Fhir Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Fhir Wing', code: 'FH' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const svc = new PatientService(patients, outbox);
    mrn = `FH${Date.now()}`;
    const reg = await svc.register({
      familyName: 'Fhir',
      givenName: 'Pat',
      dateOfBirth: '1995-05-05',
      sex: 'M',
      facilityId: fac.id,
      mrn,
    });
    patientId = reg.patient.id;
    await new KyselyClinicalRepository(db).recordObservation({
      patientId,
      code: 'BP_SYS',
      valueNum: 120,
      unit: 'mmHg',
    });
    await db
      .insertInto('integration.partner')
      .values({ name: `partner-${Date.now()}`, api_key_hash: hashApiKey('test-key-1'), scopes: ['read'] })
      .returning(['id'])
      .executeTakeFirstOrThrow()
      .then((r) => {
        partnerId = r.id;
      });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('reads Patient as FHIR with namespaced identifiers', async () => {
    const p = (await fhir.readPatient(patientId, partnerId)) as {
      resourceType: string;
      gender: string;
      identifier: { system: string }[];
    };
    expect(p.resourceType).toBe('Patient');
    expect(p.gender).toBe('male');
    expect(p.identifier[0]?.system).toContain('urn:pulse:mrn:');
  });

  it('searches Patient by identifier value and Observation by patient', async () => {
    const found = (await fhir.searchPatient(mrn, partnerId)) as { total: number };
    expect(found.total).toBe(1);
    const obs = (await fhir.searchObservations(patientId, partnerId)) as { total: number };
    expect(obs.total).toBe(1);
  });

  it('logs FHIR access with partner attribution', async () => {
    const rows = await db
      .selectFrom('integration.fhir_log')
      .select(['resource_type'])
      .execute();
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
