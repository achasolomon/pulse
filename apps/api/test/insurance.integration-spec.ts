import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyInsuranceRepository } from './../src/modules/insurance/infrastructure/kysely-insurance.repository.js';
import { InsuranceService } from './../src/modules/insurance/application/insurance.service.js';
import { KyselyRevenueRepository } from './../src/modules/revenue/infrastructure/kysely-revenue.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('insurance foundation (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let insurance: InsuranceService;
  let facilityId: string;
  let payerId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    insurance = new InsuranceService(
      new KyselyInsuranceRepository(db),
      new OutboxService(db),
      new KyselyRevenueRepository(db),
    );

    const code = `I${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Ins Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Ins Wing', code: 'IN' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    payerId = (await insurance.definePayer({ code: `HMO-${Date.now()}`, name: 'Test HMO' })).id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('contract + versioned schedules resolve latest price; unmatched falls back empty', async () => {
    const contract = await insurance.signContract({
      facilityId,
      payerId,
      effectiveFrom: '2024-01-01',
    });
    await insurance.publishSchedule(contract.id, {
      effectiveFrom: '2024-01-01',
      lines: [{ serviceCode: 'CONSULT', price: 4000 }],
    });
    await insurance.publishSchedule(contract.id, {
      effectiveFrom: '2026-01-01',
      lines: [{ serviceCode: 'CONSULT', price: 4500 }],
    });
    // v1 effective 2024 sees v1 price; v2 effective 2026 sees v2 price
    await expect(
      insurance.resolvePrice({ facilityId, payerId, serviceCode: 'CONSULT', onDate: '2025-06-01' }),
    ).resolves.toMatchObject({ price: 4000 });
    await expect(
      insurance.resolvePrice({ facilityId, payerId, serviceCode: 'CONSULT', onDate: '2026-10-08' }),
    ).resolves.toMatchObject({ price: 4500 });
    await expect(
      insurance.resolvePrice({ facilityId, payerId, serviceCode: 'XRAY', onDate: '2026-10-08' }),
    ).resolves.toEqual({});
  });
});
