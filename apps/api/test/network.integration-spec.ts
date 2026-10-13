import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyReferralRepository } from './../src/modules/referral/infrastructure/kysely-referral.repository.js';
import { ReferralService } from './../src/modules/referral/application/referral.service.js';
import { KyselyConsentRepository } from './../src/modules/consent/infrastructure/kysely-consent.repository.js';
import { ConsentService } from './../src/modules/consent/application/consent.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('consent-gated referral (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let referrals: ReferralService;
  let consent: ConsentService;
  let patientId: string;
  let sendingId: string;
  let receivingId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    referrals = new ReferralService(new KyselyReferralRepository(db), new KyselyConsentRepository(db), outbox);
    consent = new ConsentService(new KyselyConsentRepository(db), outbox);

    const code = `N${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Net Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const s = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Sender', code: 'SND' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const r = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Receiver', code: 'RCV' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    sendingId = s.id;
    receivingId = r.id;
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Net',
      givenName: 'Pat',
      dateOfBirth: '1994-04-04',
      sex: 'F',
      facilityId: sendingId,
      mrn: `NT${Date.now()}`,
    });
    patientId = reg.patient.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('draft -> submit blocked without consent; full chain with consent; withdrawal blocks resend', async () => {
    const c = await referrals.create({
      patientId,
      sendingFacilityId: sendingId,
      receivingFacilityId: receivingId,
      type: 'routine',
      urgency: 'routine',
      clinicalQuestion: 'Needs cardiology review',
    });
    await expect(referrals.submit(c.id, {})).rejects.toThrow('Active referral consent');

    const grant = await consent.capture({
      patientId,
      grantee: receivingId,
      purpose: 'referral',
      scope: 'clinical-summary',
    });
    await referrals.submit(c.id, { package: { question: 'Needs cardiology review' } });
    await referrals.acknowledge(c.id, {});
    await referrals.requestInfo(c.id, 'Please attach ECG', undefined, {});
    await referrals.resubmit(c.id, { package: { question: 'With ECG attached' } });
    await referrals.acknowledge(c.id, {});
    await referrals.accept(c.id, {});
    await referrals.schedule(c.id, {});
    await referrals.dispatch(c.id, {});
    await referrals.arrive(c.id, {});
    await referrals.close(c.id, {});

    const inbox = await new KyselyReferralRepository(db).inbox(receivingId, 50);
    expect(inbox.some((i) => i.id === c.id)).toBe(false); // closed leaves the active inbox

    // withdrawal blocks the next send but keeps history
    await consent.withdraw(grant.id, 'Patient changed mind');
    const c2 = await referrals.create({
      patientId,
      sendingFacilityId: sendingId,
      receivingFacilityId: receivingId,
      type: 'routine',
      urgency: 'routine',
      clinicalQuestion: 'Second opinion',
    });
    await expect(referrals.submit(c2.id, {})).rejects.toThrow('Active referral consent');
    const disclosures = await db
      .selectFrom('consent.disclosure')
      .select(['case_id'])
      .where('patient_id', '=', patientId)
      .execute();
    expect(disclosures.length).toBeGreaterThanOrEqual(1);
  });
});
