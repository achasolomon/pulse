import { BillingProjector } from './billing-projector.service.js';
import type { RevenueRepository } from '../domain/revenue.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('BillingProjector (unit, fakes)', () => {
  function fake(events: { eventId: string; type: string; payload: Record<string, unknown> }[] = []) {
    const charges: { sourceEventId?: string }[] = [];
    const repo: RevenueRepository = {
      defineService: async () => ({ id: 's1' }),
      findService: async (code) => (code === 'CONSULT' ? { id: 's1', defaultPrice: 100 } : undefined),
      captureCharge: async (input) => {
        charges.push({ sourceEventId: input.sourceEventId });
        return { id: `c${charges.length}` };
      },
      findCharge: async () => undefined,
      findChargeBySourceEvent: async (eventId) =>
        charges.some((c) => c.sourceEventId === eventId) ? { id: 'c1' } : undefined,
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
      findCoverage: async () => undefined,
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
      activeRules: async () => [
        { eventType: 'appointment.booked', serviceCode: 'CONSULT', quantity: 1, active: true },
      ],
    };
    const outbox = {
      peekUnpublished: async () => events,
    } as unknown as OutboxService;
    return { repo, outbox, charges };
  }

  it('projects fixed-code rules and skips unknown types/services', async () => {
    const f = fake([
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        type: 'appointment.booked',
        payload: { id: 'a1', patientId: 'p1' },
      },
      {
        eventId: '22222222-2222-4222-8222-222222222222',
        type: 'alien.probe',
        payload: {},
      },
    ]);
    const projector = new BillingProjector(f.repo, f.outbox);
    const res = await projector.project({});
    expect(res).toEqual({ projected: 1, skipped: 1 });
    expect(f.charges).toHaveLength(1);
  });

  it('re-runs create zero duplicates (source_event_id guard)', async () => {
    const events = [
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        type: 'appointment.booked',
        payload: { id: 'a1', patientId: 'p1' },
      },
    ];
    const f = fake(events);
    const projector = new BillingProjector(f.repo, f.outbox);
    await projector.project({});
    const second = await projector.project({});
    expect(second).toEqual({ projected: 0, skipped: 1 });
    expect(f.charges).toHaveLength(1);
  });

  it('returns zeros with no active rules (no outbox touch)', async () => {
    const f = fake();
    f.repo.activeRules = async () => [];
    const projector = new BillingProjector(f.repo, f.outbox);
    await expect(projector.project({})).resolves.toEqual({ projected: 0, skipped: 0 });
  });
});
