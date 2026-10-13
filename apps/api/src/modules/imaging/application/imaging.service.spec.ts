import { ImagingService } from './imaging.service.js';
import { requiresLaterality, transitionImaging } from '../domain/imaging.repository.js';
import type { ImagingRepository } from '../domain/imaging.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('imaging machine + laterality', () => {
  it('requires laterality for paired regions only', () => {
    expect(requiresLaterality('kidney')).toBe(true);
    expect(requiresLaterality('Kidney')).toBe(true);
    expect(requiresLaterality('abdomen')).toBe(false);
  });

  it('ordered -> scheduled -> protocolled -> acquired -> reported -> final', () => {
    expect(transitionImaging('ordered', 'schedule')).toBe('scheduled');
    expect(transitionImaging('scheduled', 'protocol')).toBe('protocolled');
    expect(transitionImaging('protocolled', 'acquire')).toBe('acquired');
    expect(transitionImaging('acquired', 'report')).toBe('reported');
    expect(transitionImaging('reported', 'finalize')).toBe('final');
  });

  it('illegal moves + terminal cancel bar', () => {
    expect(() => transitionImaging('ordered', 'acquire')).toThrow('IMG_TRANSITION');
    expect(() => transitionImaging('final', 'cancel')).toThrow('IMG_TRANSITION');
    expect(transitionImaging('ordered', 'cancel')).toBe('cancelled');
  });
});

describe('ImagingService (unit, fake repo)', () => {
  function fake(): ImagingRepository {
    const orders = new Map<string, { status: 'ordered' | 'scheduled' | 'protocolled' | 'acquired' | 'reported' | 'final' | 'cancelled' }>();
    return {
      order: async () => {
        const id = 'cccccccc-3333-4333-8333-333333333333';
        orders.set(id, { status: 'ordered' });
        return { id, status: 'ordered' };
      },
      findOrder: async (id) => {
        const o = orders.get(id);
        return o ? { id, status: o.status } : undefined;
      },
      setStatus: async (id, status) => {
        orders.set(id, { status });
      },
      linkStudy: async () => ({ id: 's1' }),
      saveReport: async () => ({ id: 'r1', version: 1 }),
      finalizeReport: async () => ({ version: 1 }),
      worklist: async () => [],
    };
  }

  it('rejects kidney order without laterality (400)', async () => {
    const svc = new ImagingService(fake(), new OutboxService(undefined));
    await expect(
      svc.placeOrder({
        patientId: 'p',
        encounterId: 'e',
        procedureCode: 'US-KID',
        bodyRegion: 'kidney',
        indication: '',
        urgency: 'routine',
      }),
    ).rejects.toThrow('Laterality is required');
  });

  it('rejects acquire before protocol (422)', async () => {
    const svc = new ImagingService(fake(), new OutboxService(undefined));
    const order = await svc.placeOrder({
      patientId: 'p',
      encounterId: 'e',
      procedureCode: 'CT-ABD',
      bodyRegion: 'abdomen',
      indication: '',
      urgency: 'routine',
    });
    const err = await svc
      .acquire(order.id, { studyUid: 'u', accession: '', modality: '', pacsRef: '' }, {})
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });
});
