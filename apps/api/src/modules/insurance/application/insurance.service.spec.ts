import { InsuranceService } from './insurance.service.js';
import { selectTariffLine } from '../domain/insurance.repository.js';
import type { InsuranceRepository } from '../domain/insurance.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('selectTariffLine (pure)', () => {
  it('picks the latest schedule version for an exact service match', () => {
    expect(
      selectTariffLine(
        [
          { id: 'v1', serviceCode: 'CONSULT', price: 4000, scheduleVersion: 1 },
          { id: 'v2', serviceCode: 'CONSULT', price: 4500, scheduleVersion: 2 },
          { id: 'x', serviceCode: 'XRAY', price: 9000, scheduleVersion: 9 },
        ],
        'CONSULT',
      ),
    ).toEqual({ id: 'v2', price: 4500 });
  });

  it('returns undefined on no match — never fuzzy, never silent', () => {
    expect(selectTariffLine([], 'CONSULT')).toBeUndefined();
    expect(
      selectTariffLine(
        [{ id: 'x', serviceCode: 'XRAY', price: 1, scheduleVersion: 1 }],
        'CONSULT',
      ),
    ).toBeUndefined();
  });
});

describe('InsuranceService dark resolvePrice (unit, fake repo)', () => {
  function fake(
    lines: { id: string; serviceCode: string; price: number; scheduleVersion: number }[] = [],
  ): InsuranceRepository {
    return {
      definePayer: async (input) => ({ id: 'p1', code: input.code, name: input.name, active: true }),
      signContract: async () => ({ id: 'c1' }),
      publishSchedule: async () => ({ id: 's1', version: 1 }),
      setTariffLine: async () => ({ id: 'l1' }),
      candidateLines: async () => lines,
      recordEligibility: async () => ({ id: 'e1' }),
      openPreauth: async () => ({ id: 'pa1', status: 'requested' as const }),
      findPreauth: async () => undefined,
      setPreauthStatus: async () => undefined,
      defineBenefit: async () => ({ id: 'b1' }),
      findBenefit: async () => ({ deductibleAnnual: 0, copayAmount: 0, coinsurancePct: 0 }),
      deductibleUsed: async () => 0,
      postDeductibleUse: async () => undefined,
    };
  }

  function revenueStub(): import('../../revenue/domain/revenue.repository.js').RevenueRepository {
    return {
      defineService: async () => ({ id: 's1' }),
      findService: async () => ({ id: 's1', defaultPrice: 100 }),
      captureCharge: async () => ({ id: 'c1' }),
      findChargeBySourceEvent: async (): Promise<{ id: string } | undefined> => undefined,
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
    };
  }

  it('resolves contract price when matched', async () => {
    const svc = new InsuranceService(
      fake([{ id: 'l2', serviceCode: 'CONSULT', price: 4500, scheduleVersion: 2 }]),
      new OutboxService(undefined),
      revenueStub(),
    );
    await expect(
      svc.resolvePrice({ facilityId: 'f', payerId: 'p', serviceCode: 'CONSULT', onDate: '2026-10-08' }),
    ).resolves.toEqual({ price: 4500, tariffId: 'l2' });
  });

  it('returns empty (caller falls back to default_price) when unmatched', async () => {
    const svc = new InsuranceService(fake([]), new OutboxService(undefined), revenueStub());
    await expect(
      svc.resolvePrice({ facilityId: 'f', payerId: 'p', serviceCode: 'CONSULT', onDate: '2026-10-08' }),
    ).resolves.toEqual({});
  });
});
