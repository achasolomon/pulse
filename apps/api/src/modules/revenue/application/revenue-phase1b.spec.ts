import { RevenueService } from './revenue.service.js';
import { checkAllocation } from '../domain/revenue.repository.js';
import type { RevenueRepository } from '../domain/revenue.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('checkAllocation (pure invariant)', () => {
  it('accepts shares summing to total at 100%', () => {
    expect(() =>
      checkAllocation(15000, [
        { sharePct: 80, amount: 12000 },
        { sharePct: 20, amount: 3000 },
      ]),
    ).not.toThrow();
  });

  it('rejects empty, pct drift, and sum drift', () => {
    expect(() => checkAllocation(100, [])).toThrow('ALLOCATION_EMPTY');
    expect(() => checkAllocation(100, [{ sharePct: 90, amount: 100 }])).toThrow('ALLOCATION_PCT');
    expect(() =>
      checkAllocation(100, [
        { sharePct: 50, amount: 50 },
        { sharePct: 50, amount: 40 },
      ]),
    ).toThrow('ALLOCATION_SUM');
  });
});

describe('RevenueService.allocate (unit, fake repo)', () => {
  function fake(): RevenueRepository {
    return {
      defineService: async () => ({ id: 's1' }),
      findService: async () => ({ id: 's1', defaultPrice: 100 }),
      captureCharge: async () => ({ id: 'c1' }),
      findChargeBySourceEvent: async () => undefined,
      findCharge: async () => ({ quantity: 2, unitPrice: 5000 }),
      cancelCharge: async () => undefined,
      createInvoice: async () => ({ id: 'i1' }),
      addLine: async () => undefined,
      setInvoiceStatus: async () => undefined,
      invoiceTotals: async () => ({ lines: [] }),
      invoiceChargeIds: async () => [],
      invoicesFor: async () => [],
      recordPayment: async () => ({ id: 'p1' }),
      paymentsFor: async () => [],
      recordAdjustment: async () => ({ id: 'a1' }),
      adjustmentsFor: async () => [],
      addCoverage: async () => ({ id: 'c1' }),
      findCoverage: async (): Promise<
        { id: string; patientId: string; payer: string; plan: string; memberId: string } | undefined
      > => undefined,
      checkEligibility: async () => undefined,
      authorize: async () => ({ id: 'au1' }),
      fileClaim: async () => ({ id: 'cl1' }),
      findClaim: async () => ({ id: 'cl1', status: 'draft' }),
      setClaimStatus: async () => undefined,
      allocate: async () => undefined,
      allocationsForCharge: async () => [],
      outstandingByParty: async () => [],
      addClaimLine: async () => undefined,
      submitClaimVersion: async () => ({ version: 1 }),
      claimVersions: async () => [],
      defineRule: async () => ({ id: 'r1' }),
      activeRules: async () => [],
    };
  }

  it('allocates 80/20 across payer + patient', async () => {
    const svc = new RevenueService(fake(), new OutboxService(undefined));
    const res = await svc.allocate('c1', [
      { partyType: 'payer', partyRef: 'hmo-1', sharePct: 80, amount: 8000 },
      { partyType: 'patient', partyRef: 'p1', sharePct: 20, amount: 2000 },
    ]);
    expect(res).toEqual({ id: 'c1', parties: 2 });
  });

  it('rejects unbalanced splits (422)', async () => {
    const svc = new RevenueService(fake(), new OutboxService(undefined));
    const err = await svc
      .allocate('c1', [{ partyType: 'payer', partyRef: 'hmo-1', sharePct: 80, amount: 7000 }])
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('returns 404 for unknown charge (no leakage)', async () => {
    const repo = fake();
    repo.findCharge = async () => undefined;
    const svc = new RevenueService(repo, new OutboxService(undefined));
    const err = await svc
      .allocate('11111111-1111-4111-8111-111111111111', [
        { partyType: 'payer', partyRef: 'hmo-1', sharePct: 100, amount: 10 },
      ])
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(404);
  });
});
