import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyInsuranceRepository } from './../src/modules/insurance/infrastructure/kysely-insurance.repository.js';
import { InsuranceService } from './../src/modules/insurance/application/insurance.service.js';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { RevenueService } from './../src/modules/revenue/application/revenue.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Full insured chain: tariff price -> allocation -> eligibility -> preauth -> claim versions, cash parity intact. */
describe.skipIf(!hasDb)('insured billing chain (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let insurance: InsuranceService;
  let revenue: RevenueService;
  let patientId: string;
  let encounterId: string;
  let facilityId: string;
  let payerId: string;
  let coverageId: string;
  let memberId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    insurance = new InsuranceService(
      new KyselyInsuranceRepository(db),
      outbox,
      new KyselyRevenueRepository(db),
    );
    revenue = new RevenueService(new KyselyRevenueRepository(db), outbox);

    const code = `B${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Ins Bil Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Ins Billing', code: 'IB' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Insured',
      givenName: 'Pat',
      dateOfBirth: '1990-06-06',
      sex: 'F',
      facilityId,
      mrn: `IN${Date.now()}`,
    });
    patientId = reg.patient.id;
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const enc = await encounters.open({ patientId, facilityId, type: 'outpatient' });
    encounterId = enc.id;

    payerId = (await insurance.definePayer({ code: `HMO-${Date.now()}`, name: 'Chain HMO' })).id;
    const contract = await insurance.signContract({ facilityId, payerId, effectiveFrom: '2024-01-01' });
    await insurance.publishSchedule(contract.id, {
      effectiveFrom: '2024-01-01',
      lines: [{ serviceCode: 'CONSULT', price: 4500 }],
    });
    await revenue.defineService({ code: 'CONSULT', name: 'Consultation', defaultPrice: 5000 });
    // Unique member per run: the deductible ledger accumulates per member-year,
    // so a hardcoded member would leak state across runs sharing a database.
    memberId = `G-${Date.now()}`;
    const cov = await db
      .insertInto('rev.coverage')
      .values({
        patient_id: patientId,
        payer: 'Chain HMO',
        plan: 'Gold',
        member_id: memberId,
        effective_from: '2024-01-01',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    coverageId = cov.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('tariff price resolves; allocation sums exactly; eligibility + preauth + claim versions', async () => {
    const resolved = await insurance.resolvePrice({
      facilityId,
      payerId,
      serviceCode: 'CONSULT',
      onDate: '2026-10-08',
    });
    expect(resolved.price).toBe(4500);

    const charge = await revenue.captureCharge({
      patientId,
      encounterId,
      serviceCode: 'CONSULT',
      quantity: 2,
      unitPrice: resolved.price ?? 5000,
    });
    await revenue.allocate(charge.id, [
      { partyType: 'payer', partyRef: payerId, sharePct: 80, amount: 7200, ...(resolved.tariffId ? { tariffId: resolved.tariffId } : {}) },
      { partyType: 'patient', partyRef: patientId, sharePct: 20, amount: 1800 },
    ]);
    await expect(
      revenue.allocate(charge.id, [
        { partyType: 'payer', partyRef: payerId, sharePct: 80, amount: 7000 },
      ]),
    ).rejects.toThrow();

    const elig = await insurance.checkEligibility({
      coverageId,
      encounterId,
      method: 'manual',
      evidence: 'HMO card sighted, ref E-100',
      result: 'eligible',
    });
    expect(elig.id).toBeDefined();

    const pre = await insurance.openPreauth({ coverageId, encounterId, lines: [{ service: 'CONSULT' }] });
    await insurance.requestPreauthDocs(pre.id, {});
    await insurance.resubmitPreauth(pre.id, {});
    const decided = await insurance.decidePreauth(pre.id, { approved: true, expiresOn: '2026-12-31' });
    expect(decided.status).toBe('approved');

    const invoice = await revenue.invoice({ patientId, chargeIds: [charge.id] });
    const parties = await revenue.outstandingByParty(invoice.id);
    expect(parties.reduce((s, p) => s + p.outstanding, 0)).toBe(9000);

    const claim = await revenue.fileClaim(invoice.id, 'Chain HMO', {});
    await revenue.assembleClaimLines(claim.id, invoice.id);
    await revenue.submitVersion(claim.id, { payerClaimId: 'PAYER-1' });
    await revenue.submitVersion(claim.id, { payerClaimId: 'PAYER-1-R2' });
    const versions = await revenue.claimVersions(claim.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('benefit rules drive allocation; re-apply posts deductible once', async () => {
    await insurance.defineBenefit({
      payerCode: 'Chain HMO',
      plan: 'Gold',
      deductibleAnnual: 5000,
      copayAmount: 500,
      coinsurancePct: 20,
      effectiveFrom: '2024-01-01',
    });
    const charge = await revenue.captureCharge({
      patientId,
      encounterId,
      serviceCode: 'CONSULT',
      quantity: 2,
      unitPrice: 5000,
    });
    // gross 10000, nothing used: deductible 5000, copay 500, coinsurance 20% of 4500 = 900
    const split = await insurance.applyBenefits(charge.id, coverageId, { onDate: '2026-10-08' });
    expect(split).toMatchObject({ deductibleApplied: 5000, patientTotal: 6400, payerTotal: 3600 });

    const repo = new KyselyInsuranceRepository(db);
    expect(await repo.deductibleUsed('Chain HMO', 'Gold', memberId, 2026)).toBe(5000);

    // Re-apply: deductible ledger unchanged (charge-linked, once only).
    await insurance.applyBenefits(charge.id, coverageId, { onDate: '2026-10-08' });
    expect(await repo.deductibleUsed('Chain HMO', 'Gold', memberId, 2026)).toBe(5000);

    // Second charge consumes remaining deductible (0 left): copay + coinsurance only.
    const charge2 = await revenue.captureCharge({
      patientId,
      encounterId,
      serviceCode: 'CONSULT',
      quantity: 1,
      unitPrice: 5000,
    });
    const split2 = await insurance.applyBenefits(charge2.id, coverageId, { onDate: '2026-10-08' });
    expect(split2).toMatchObject({ deductibleApplied: 0, patientTotal: 1400, payerTotal: 3600 });

    const allocations = await new KyselyRevenueRepository(db).allocationsForCharge(charge.id);
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(10000);
  });
});
