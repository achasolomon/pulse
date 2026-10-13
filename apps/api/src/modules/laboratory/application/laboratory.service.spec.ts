import { LaboratoryService } from './laboratory.service.js';
import { transitionLabOrder } from '../domain/lab.repository.js';
import type { LabRepository } from '../domain/lab.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transitionLabOrder', () => {
  it('ordered -> collected -> accessioned -> resulted -> verified', () => {
    expect(transitionLabOrder('ordered', 'collect')).toBe('collected');
    expect(transitionLabOrder('collected', 'accession')).toBe('accessioned');
    expect(transitionLabOrder('accessioned', 'result')).toBe('resulted');
    expect(transitionLabOrder('resulted', 'result')).toBe('resulted');
    expect(transitionLabOrder('resulted', 'verify')).toBe('verified');
  });

  it('cancel rules + illegal moves', () => {
    expect(transitionLabOrder('ordered', 'cancel')).toBe('cancelled');
    expect(() => transitionLabOrder('verified', 'cancel')).toThrow('LAB_TRANSITION');
    expect(() => transitionLabOrder('ordered', 'verify')).toThrow('LAB_TRANSITION');
    expect(() => transitionLabOrder('cancelled', 'collect')).toThrow('LAB_TRANSITION');
  });
});

describe('LaboratoryService (unit, fake repo)', () => {
  function fake(): LabRepository {
    const orders = new Map<string, { status: 'ordered' | 'collected' | 'accessioned' | 'resulted' | 'verified' | 'cancelled' }>();
    return {
      upsertTest: async (input) => ({
        id: 't1',
        code: input.code,
        name: input.name,
        specimenRequirement: input.specimenRequirement,
        version: 1,
        active: true,
      }),
      findTest: async (code) => ({
        id: 't1',
        code,
        name: 'Test',
        specimenRequirement: '',
        version: 1,
        active: true,
      }),
      order: async (input) => {
        const id = 'bbbbbbbb-2222-4222-8222-222222222222';
        orders.set(id, { status: 'ordered' });
        return {
          id,
          patientId: input.patientId,
          encounterId: input.encounterId,
          testId: input.testId,
          testVersion: input.testVersion,
          urgency: input.urgency,
          status: 'ordered',
        };
      },
      findOrder: async (id) => {
        const o = orders.get(id);
        if (!o) return undefined;
        return {
          id,
          patientId: 'p',
          encounterId: 'e',
          testId: 't1',
          testVersion: 1,
          urgency: 'routine',
          status: o.status,
        };
      },
      setStatus: async (id, status) => {
        orders.set(id, { status });
        return {
          id,
          patientId: 'p',
          encounterId: 'e',
          testId: 't1',
          testVersion: 1,
          urgency: 'routine',
          status,
        };
      },
      collectSpecimen: async () => ({ id: 's1' }),
      addResult: async (_orderId, input) => ({
        id: 'r1',
        critical: input.flag === 'critical',
      }),
      acknowledgeCritical: async () => undefined,
      worklist: async () => [],
      ordersFor: async () => [],
    };
  }

  it('rejects unknown test code', async () => {
    const repo = fake();
    repo.findTest = async () => undefined;
    const svc = new LaboratoryService(repo, new OutboxService(undefined));
    await expect(
      svc.placeOrder({
        patientId: 'p',
        encounterId: 'e',
        testCode: 'NOPE',
        urgency: 'routine',
        indication: '',
      }),
    ).rejects.toThrow('No active catalogue entry');
  });

  it('requires specimen label on collect (400)', async () => {
    const svc = new LaboratoryService(fake(), new OutboxService(undefined));
    const order = await svc.placeOrder({
      patientId: 'p',
      encounterId: 'e',
      testCode: 'FBC',
      urgency: 'routine',
      indication: '',
    });
    const err = await svc
      .collect(order.id, { container: '', label: '' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });

  it('rejects verify before resulted (422)', async () => {
    const svc = new LaboratoryService(fake(), new OutboxService(undefined));
    const order = await svc.placeOrder({
      patientId: 'p',
      encounterId: 'e',
      testCode: 'FBC',
      urgency: 'routine',
      indication: '',
    });
    const err = await svc
      .verify(order.id, { verifiedBy: '11111111-1111-1111-1111-111111111111' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });
});
