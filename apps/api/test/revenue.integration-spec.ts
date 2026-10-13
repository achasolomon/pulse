import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { RevenueService } from './../src/modules/revenue/application/revenue.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('revenue cycle (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let revenue: RevenueService;
  let patientId: string;
  let encounterId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    revenue = new RevenueService(new KyselyRevenueRepository(db), outbox);

    const code = `R${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Rev Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Billing', code: 'BL' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Rev',
      givenName: 'Pat',
      dateOfBirth: '1993-03-03',
      sex: 'F',
      facilityId: fac.id,
      mrn: `RV${Date.now()}`,
    });
    patientId = reg.patient.id;
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const enc = await encounters.open({ patientId, facilityId: fac.id, type: 'outpatient' });
    encounterId = enc.id;
    await revenue.defineService({ code: 'CONSULT', name: 'Consultation', defaultPrice: 5000 });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('charge -> invoice -> partial -> paid; refund tracked; clinical untouched', async () => {
    const c1 = await revenue.captureCharge({ patientId, encounterId, serviceCode: 'CONSULT', quantity: 1 });
    const c2 = await revenue.captureCharge({ patientId, encounterId, serviceCode: 'CONSULT', quantity: 2 });
    const invoice = await revenue.invoice({ patientId, chargeIds: [c1.id, c2.id] });
    let b = await revenue.balance(invoice.id);
    expect(b).toEqual({ total: 15000, paid: 0, outstanding: 15000 });

    await revenue.pay(invoice.id, { amount: 5000, method: 'cash' });
    b = await revenue.balance(invoice.id);
    expect(b.outstanding).toBe(10000);
    await revenue.pay(invoice.id, { amount: 10000, method: 'transfer' });
    b = await revenue.balance(invoice.id);
    expect(b.outstanding).toBe(0);

    await revenue.adjust(invoice.id, { amount: 2000, kind: 'refund', reason: 'Duplicate charge refunded' });
    b = await revenue.balance(invoice.id);
    expect(b.outstanding).toBe(2000);

    // clinical truth untouched by money movement
    const enc = await db
      .selectFrom('encounter.encounter')
      .select(['status'])
      .where('id', '=', encounterId)
      .executeTakeFirstOrThrow();
    expect(enc.status).toBe('open');
  });

  it('coverage -> eligibility -> authorization -> claim deny/appeal loop', async () => {
    const cov = await revenue.addCoverage({
      patientId,
      payer: 'NHIS',
      plan: 'Basic',
      memberId: 'NH-1',
      effectiveFrom: '2024-01-01',
    });
    const elig = await revenue.eligibility(patientId, '2026-10-08');
    expect(elig?.payer).toBe('NHIS');
    await revenue.authorize({ coverageId: cov.id, encounterId, approvedAmount: 10000, status: 'approved' });

    const c = await revenue.captureCharge({ patientId, encounterId, serviceCode: 'CONSULT', quantity: 1 });
    const inv = await revenue.invoice({ patientId, chargeIds: [c.id] });
    const claim = await revenue.fileClaim(inv.id, 'NHIS', {});
    await revenue.submitClaim(claim.id, {});
    await revenue.denyClaim(claim.id, { denialReason: 'Missing authorization code' });
    await revenue.appealClaim(claim.id, {});
    await revenue.submitClaim(claim.id, {});
    await revenue.acknowledgeClaim(claim.id, {});
    const done = await revenue.payClaim(claim.id, {});
    expect(done.status).toBe('paid');
  });
});
