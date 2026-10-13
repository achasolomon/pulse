import { RevenueService } from './revenue.service.js';
import { invoiceBalance, transitionClaim } from '../domain/revenue.repository.js';
import type { RevenueRepository } from '../domain/revenue.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('invoiceBalance (pure)', () => {
  it('totals, pays, refunds adjust outstanding', () => {
    expect(
      invoiceBalance({
        lines: [{ amount: 100 }, { amount: 50 }],
        payments: [{ amount: 100 }],
        adjustments: [{ kind: 'refund', amount: 20 }],
      }),
    ).toEqual({ total: 150, paid: 100, outstanding: 70 });
  });

  it('write-offs do not inflate outstanding', () => {
    expect(
      invoiceBalance({
        lines: [{ amount: 100 }],
        payments: [],
        adjustments: [{ kind: 'write-off', amount: 100 }],
      }),
    ).toEqual({ total: 100, paid: 0, outstanding: 100 });
  });
});

describe('transitionClaim', () => {
  it('draft -> submitted -> acknowledged -> paid; deny/appeal loop', () => {
    expect(transitionClaim('draft', 'submit')).toBe('submitted');
    expect(transitionClaim('submitted', 'acknowledge')).toBe('acknowledged');
    expect(transitionClaim('acknowledged', 'pay')).toBe('paid');
    expect(transitionClaim('acknowledged', 'deny')).toBe('denied');
    expect(transitionClaim('denied', 'appeal')).toBe('appealed');
    expect(transitionClaim('appealed', 'submit')).toBe('submitted');
  });

  it('rejects paying a draft', () => {
    expect(() => transitionClaim('draft', 'pay')).toThrow('CLAIM_TRANSITION');
  });
});

describe('RevenueService (unit, fake repo)', () => {
  function fake(): RevenueRepository {
    const charges = new Map<string, { quantity: number; unitPrice: number }>();
    return {
      defineService: async () => ({ id: 's1' }),
      findService: async () => ({ id: 's1', defaultPrice: 100 }),
      captureCharge: async (input) => {
        const id = 'eeeeeeee-5555-4555-8555-555555555555';
        charges.set(id, { quantity: input.quantity, unitPrice: input.unitPrice });
        return { id };
      },
      findCharge: async (id) => charges.get(id),
      findChargeBySourceEvent: async (): Promise<{ id: string } | undefined> => undefined,
      cancelCharge: async () => undefined,
      createInvoice: async () => ({ id: 'i1' }),
      addLine: async () => undefined,
      setInvoiceStatus: async () => undefined,
      invoiceTotals: async () => ({ lines: [{ amount: 200 }] }),
      invoiceChargeIds: async () => [],
      invoicesFor: async () => [],
      recordPayment: async () => ({ id: 'p1' }),
      paymentsFor: async () => [{ amount: 150 }],
      recordAdjustment: async () => ({ id: 'a1' }),
      adjustmentsFor: async () => [],
      addCoverage: async () => ({ id: 'c1' }),
      findCoverage: async (): Promise<
        { id: string; patientId: string; payer: string; plan: string; memberId: string } | undefined
      > => undefined,
      checkEligibility: async () => ({ payer: 'NHIS', plan: 'Basic' }),
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

  it('invoices with charge-derived amounts and computes balance', async () => {
    const svc = new RevenueService(fake(), new OutboxService(undefined));
    const charge = await svc.captureCharge({
      patientId: 'p',
      serviceCode: 'CONSULT',
      quantity: 2,
    });
    expect(charge.id).toBeDefined();
    const balance = await svc.balance('i1');
    expect(balance).toEqual({ total: 200, paid: 150, outstanding: 50 });
  });

  it('rejects non-positive charge quantity (400)', async () => {
    const svc = new RevenueService(fake(), new OutboxService(undefined));
    const err = await svc
      .captureCharge({ patientId: 'p', serviceCode: 'X', quantity: 0 })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });
});
