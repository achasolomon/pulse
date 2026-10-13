import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyPortalRepository } from './../src/modules/portal/infrastructure/kysely-portal.repository.js';
import { PortalService } from './../src/modules/portal/application/portal.service.js';
import { PortalReadsService } from './../src/modules/portal/application/portal-reads.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyAppointmentRepository } from './../src/modules/scheduling/infrastructure/kysely-appointment.repository.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { KyselyMedicationRepository } from './../src/modules/medication/infrastructure/kysely-medication.repository.js';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { KyselyReferralRepository } from './../src/modules/referral/infrastructure/kysely-referral.repository.js';
import { KyselyLabRepository } from './../src/modules/laboratory/infrastructure/kysely-lab.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('patient portal (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let portal: PortalService;
  let reads: PortalReadsService;
  let patientId: string;
  let otherId: string;
  let facilityId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    portal = new PortalService(new KyselyPortalRepository(db), outbox);
    reads = new PortalReadsService(
      patientRepo,
      new KyselyAppointmentRepository(db),
      new KyselyClinicalRepository(db),
      new KyselyMedicationRepository(db),
      new KyselyRevenueRepository(db),
      new KyselyReferralRepository(db),
      new KyselyLabRepository(db),
    );

    const code = `W${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Portal Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Portal Desk', code: 'PD' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    patientId = (
      await patients.register({
        familyName: 'Portal', givenName: 'Pat', dateOfBirth: '1997-07-07',
        sex: 'F', facilityId, mrn: `PT${Date.now()}`,
      })
    ).patient.id;
    otherId = (
      await patients.register({
        familyName: 'Other', givenName: 'Pat', dateOfBirth: '1990-01-01',
        sex: 'M', facilityId, mrn: `OT${Date.now()}`,
      })
    ).patient.id;
    await portal.register({ patientId, loginId: `pat-${Date.now()}`, secret: 'correct-horse-1' });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('login -> own reads; proxy act-as; logout revokes', async () => {
    const loginId = `pat-${Date.now()}-b`;
    await portal.register({ patientId, loginId, secret: 'correct-horse-1' });
    const session = await portal.login({ loginId, secret: 'correct-horse-1' });
    expect(session.patientId).toBe(patientId);

    const me = await reads.me(patientId);
    expect(me?.id).toBe(patientId);
    const appts = await reads.appointments(patientId);
    expect(Array.isArray(appts)).toBe(true);

    const proxy = await portal.register({ patientId: otherId, loginId: `proxy-${Date.now()}`, secret: 'correct-horse-2' });
    await portal.grantProxy({
      dependentPatientId: patientId,
      proxyAccountId: proxy.id,
      relationship: 'parent',
      scopes: ['read'],
    });
    const acting = await portal.actAs({ proxyAccountId: proxy.id, dependentPatientId: patientId });
    expect(acting.patientId).toBe(patientId);
    const asDependent = await reads.me(acting.patientId);
    expect(asDependent?.id).toBe(patientId);

    await portal.logout(session.sessionId);
    const sessions = await db
      .selectFrom('portal.session')
      .select(['revoked_at'])
      .where('id', '=', session.sessionId)
      .executeTakeFirstOrThrow();
    expect(sessions.revoked_at).not.toBeNull();
  });
});
