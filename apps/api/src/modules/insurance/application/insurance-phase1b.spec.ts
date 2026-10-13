import { InsuranceService } from './insurance.service.js';
import { computeSplit, transitionPreauth } from '../domain/insurance.repository.js';
import type { InsuranceRepository } from '../domain/insurance.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transitionPreauth', () => {
  it('requested -> docs-requested -> requested -> approved; deny path', () => {
    expect(transitionPreauth('requested', 'request-docs')).toBe('docs-requested');
    expect(transitionPreauth('docs-requested', 'resubmit')).toBe('requested');
    expect(transitionPreauth('requested', 'approve')).toBe('approved');
    expect(transitionPreauth('requested', 'deny')).toBe('denied');
  });

  it('expiry from live states; illegal moves rejected', () => {
    expect(transitionPreauth('approved', 'expire')).toBe('expired');
    expect(() => transitionPreauth('approved', 'approve')).toThrow('PREAUTH_TRANSITION');
    expect(() => transitionPreauth('denied', 'deny')).toThrow('PREAUTH_TRANSITION');
  });
});

describe('InsuranceService Phase 1b (unit, fake repo)', () => {
  function fake(): InsuranceRepository {
    const preauth = new Map<string, { status: 'requested' | 'docs-requested' | 'approved' | 'denied' | 'expired' | 'cancelled' }>();
    return {
      definePayer: async () => ({ id: 'p', code: 'H', name: 'H', active: true }),
      signContract: async () => ({ id: 'c' }),
      publishSchedule: async () => ({ id: 's', version: 1 }),
      setTariffLine: async () => ({ id: 'l' }),
      candidateLines: async () => [],
      recordEligibility: async () => ({ id: 'e1' }),
      openPreauth: async () => {
        const id = 'aaaaaaaa-7777-4777-8777-777777777777';
        preauth.set(id, { status: 'requested' });
        return { id, status: 'requested' as const };
      },
      findPreauth: async (id) => {
        const p = preauth.get(id);
        return p ? { id, status: p.status } : undefined;
      },
      setPreauthStatus: async (id, status) => {
        preauth.set(id, { status });
      },
      defineBenefit: async () => ({ id: 'b1' }),
      findBenefit: async () => undefined,
      deductibleUsed: async () => 0,
      postDeductibleUse: async () => undefined,
    };
  }

  function revenueStub(): import('../../revenue/domain/revenue.repository.js').RevenueRepository {
    return {
      defineService: async () => ({ id: 's1' }),
      findService: async () => ({ id: 's1', defaultPrice: 100 }),
      captureCharge: async () => ({ id: 'c1' }),
      findCharge: async () => ({ quantity: 1, unitPrice: 100 }),
      cancelCharge: async () => undefined,
      createInvoice: async () => ({ id: 'i1' }),
      addLine: async () => undefined,
      setInvoiceStatus: async () => undefined,
      invoiceTotals: async () => ({ lines: [] }),
      invoiceChargeIds: async () => [],
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
      invoicesFor: async () => [],
      defineRule: async () => ({ id: 'r1' }),
      activeRules: async () => [],
      findChargeBySourceEvent: async () => undefined,
    };
  }

  it('requires eligibility evidence (400)', async () => {
    const svc = new InsuranceService(fake(), new OutboxService(undefined), revenueStub());
    const err = await svc
      .checkEligibility({
        coverageId: 'c',
        method: 'manual',
        evidence: '',
        result: 'eligible',
      })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });

  it('runs request-docs -> resubmit -> approve', async () => {
    const svc = new InsuranceService(fake(), new OutboxService(undefined), revenueStub());
    const c = await svc.openPreauth({ coverageId: 'c', encounterId: 'e', lines: [] });
    await svc.requestPreauthDocs(c.id, {});
    await svc.resubmitPreauth(c.id, {});
    const done = await svc.decidePreauth(c.id, { approved: true });
    expect(done.status).toBe('approved');
  });
});

describe('computeSplit (pure engine)', () => {
  it('deductible, then copay, then coinsurance; sums to gross', async () => {
    // gross 10000, 3000 deductible left, 500 copay, 20% coinsurance:
    // deductible 3000, copay 500, coinsurance 20% of 6500 = 1300
    expect(
      computeSplit(10000, { deductibleAnnual: 5000, copayAmount: 500, coinsurancePct: 20 }, 2000),
    ).toEqual({
      deductibleApplied: 3000,
      copayApplied: 500,
      coinsuranceApplied: 1300,
      patientTotal: 4800,
      payerTotal: 5200,
    });
  });

  it('gross below remaining deductible goes fully to patient', async () => {
    expect(
      computeSplit(1000, { deductibleAnnual: 5000, copayAmount: 500, coinsurancePct: 20 }, 0),
    ).toMatchObject({ deductibleApplied: 1000, copayApplied: 0, patientTotal: 1000, payerTotal: 0 });
  });

  it('copay larger than remainder is clamped; 0% coinsurance pays nothing extra', async () => {
    expect(
      computeSplit(300, { deductibleAnnual: 0, copayAmount: 500, coinsurancePct: 0 }, 0),
    ).toMatchObject({ copayApplied: 300, coinsuranceApplied: 0, patientTotal: 300, payerTotal: 0 });
  });

  it('100% coinsurance after deductible puts the rest on the patient', async () => {
    expect(
      computeSplit(1000, { deductibleAnnual: 0, copayAmount: 0, coinsurancePct: 100 }, 0),
    ).toMatchObject({ patientTotal: 1000, payerTotal: 0 });
  });

  it('rejects bad inputs', async () => {
    expect(() => computeSplit(0, { deductibleAnnual: 0, copayAmount: 0, coinsurancePct: 0 }, 0)).toThrow(
      'BENEFIT_GROSS',
    );
    expect(() => computeSplit(100, { deductibleAnnual: 0, copayAmount: 0, coinsurancePct: 101 }, 0)).toThrow(
      'BENEFIT_RULES',
    );
  });
});

describe('InsuranceService.applyBenefits (unit, fakes)', () => {
  function fullFake() {
    const posted: { amount: number }[] = [];
    const allocated: unknown[][] = [];
    const insurance: import('../domain/insurance.repository.js').InsuranceRepository = {
      definePayer: async () => ({ id: 'p', code: 'H', name: 'H', active: true }),
      signContract: async () => ({ id: 'c' }),
      publishSchedule: async () => ({ id: 's', version: 1 }),
      setTariffLine: async () => ({ id: 'l' }),
      candidateLines: async () => [],
      recordEligibility: async () => ({ id: 'e1' }),
      openPreauth: async () => ({ id: 'pa1', status: 'requested' as const }),
      findPreauth: async () => undefined,
      setPreauthStatus: async () => undefined,
      defineBenefit: async () => ({ id: 'b1' }),
      findBenefit: async () => ({ deductibleAnnual: 5000, copayAmount: 500, coinsurancePct: 20 }),
      deductibleUsed: async () => 2000,
      postDeductibleUse: async (input: { amount: number }) => {
        posted.push({ amount: input.amount });
      },
    };
    const revenue: import('../../revenue/domain/revenue.repository.js').RevenueRepository = {
      defineService: async () => ({ id: 's1' }),
      findService: async () => ({ id: 's1', defaultPrice: 100 }),
      captureCharge: async () => ({ id: 'c1' }),
      findCharge: async () => ({ quantity: 2, unitPrice: 5000 }),
      cancelCharge: async () => undefined,
      createInvoice: async () => ({ id: 'i1' }),
      addLine: async () => undefined,
      setInvoiceStatus: async () => undefined,
      invoiceTotals: async () => ({ lines: [] }),
      invoiceChargeIds: async () => [],
      recordPayment: async () => ({ id: 'p1' }),
      paymentsFor: async () => [],
      recordAdjustment: async () => ({ id: 'a1' }),
      adjustmentsFor: async () => [],
      addCoverage: async () => ({ id: 'c1' }),
      findCoverage: async () => ({ id: 'cov1', patientId: 'p1', payer: 'HMO', plan: 'Gold', memberId: 'M-1' }),
      checkEligibility: async () => undefined,
      authorize: async () => ({ id: 'au1' }),
      fileClaim: async () => ({ id: 'cl1' }),
      findClaim: async () => ({ id: 'cl1', status: 'draft' }),
      setClaimStatus: async () => undefined,
      allocate: async (_chargeId: string, shares: unknown[]) => {
        allocated.push(shares);
      },
      allocationsForCharge: async () => [],
      outstandingByParty: async () => [],
      addClaimLine: async () => undefined,
      submitClaimVersion: async () => ({ version: 1 }),
      claimVersions: async () => [],
      invoicesFor: async () => [],
      defineRule: async () => ({ id: 'r1' }),
      activeRules: async () => [],
      findChargeBySourceEvent: async () => undefined,
    };
    return { insurance, revenue, posted, allocated };
  }

  it('posts deductible once and allocates payer/patient split', async () => {
    const f = fullFake();
    const svc = new InsuranceService(
      f.insurance as never,
      new OutboxService(undefined),
      f.revenue as never,
    );
    const split = await svc.applyBenefits('c1', 'cov1', { onDate: '2026-10-08' });
    // gross 10000, 3000 deductible left, 500 copay, 20% of 6500 = 1300
    expect(split).toMatchObject({ deductibleApplied: 3000, patientTotal: 4800, payerTotal: 5200 });
    expect(f.posted).toEqual([{ amount: 3000 }]);
    expect(f.allocated).toHaveLength(1);
  });

  it('422 when no benefit rules exist (never guesses)', async () => {
    const f = fullFake();
    f.insurance.findBenefit = async (): Promise<
      { deductibleAnnual: number; copayAmount: number; coinsurancePct: number } | undefined
    > => undefined;
    const svc = new InsuranceService(
      f.insurance as never,
      new OutboxService(undefined),
      f.revenue as never,
    );
    const err = await svc
      .applyBenefits('c1', 'cov1', { onDate: '2026-10-08' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('404 for unknown charge or coverage', async () => {
    const f = fullFake();
    f.revenue.findCharge = async (): Promise<{ quantity: number; unitPrice: number } | undefined> =>
      undefined;
    const svc = new InsuranceService(
      f.insurance as never,
      new OutboxService(undefined),
      f.revenue as never,
    );
    const err = await svc
      .applyBenefits('missing', 'cov1', { onDate: '2026-10-08' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(404);
  });
});
