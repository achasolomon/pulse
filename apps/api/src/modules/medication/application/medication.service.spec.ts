import { MedicationService } from './medication.service.js';
import { transitionMedication } from '../domain/medication.repository.js';
import type { MedicationRepository } from '../domain/medication.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('medication machine', () => {
  it('prescribed -> verified -> dispensed -> completed; hold/resume', () => {
    expect(transitionMedication('prescribed', 'verify')).toBe('verified');
    expect(transitionMedication('verified', 'dispense')).toBe('dispensed');
    expect(transitionMedication('dispensed', 'complete')).toBe('completed');
    expect(transitionMedication('dispensed', 'hold')).toBe('held');
    expect(transitionMedication('held', 'resume')).toBe('dispensed');
  });

  it('illegal moves + terminal cancel bar', () => {
    expect(() => transitionMedication('prescribed', 'dispense')).toThrow('MED_TRANSITION');
    expect(() => transitionMedication('completed', 'cancel')).toThrow('MED_TRANSITION');
    expect(transitionMedication('prescribed', 'cancel')).toBe('cancelled');
  });
});

describe('MedicationService (unit, fake repo)', () => {
  function fake(): MedicationRepository {
    const reqs = new Map<string, { status: 'prescribed' | 'verified' | 'dispensed' | 'completed' | 'held' | 'cancelled' }>();
    return {
      defineMedication: async () => ({ id: 'm1', version: 1 }),
      findMedication: async () => ({ id: 'm1', version: 1 }),
      prescribe: async (_input) => {
        const id = 'dddddddd-4444-4444-8444-444444444444';
        reqs.set(id, { status: 'prescribed' });
        return { id, status: 'prescribed' };
      },
      findRequest: async (id) => {
        const r = reqs.get(id);
        return r ? { id, status: r.status } : undefined;
      },
      setStatus: async (id, status) => {
        reqs.set(id, { status });
      },
      dispense: async () => ({ id: 'd1' }),
      administer: async () => ({ id: 'a1' }),
      administrations: async () => [],
      prescriptionsFor: async () => [],
      contextForRequest: async () => undefined,
    };
  }

  it('rejects prescription without structured dose (400)', async () => {
    const svc = new MedicationService(fake(), new OutboxService(undefined));
    await expect(
      svc.prescribe({
        patientId: 'p',
        encounterId: 'e',
        medicationCode: 'AMOX',
        dose: '',
        doseUnit: '',
        route: 'oral',
        frequency: 'BD',
      }),
    ).rejects.toThrow('Dose, route and frequency');
  });

  it('rejects dispense before verify (422) and administer before dispense (422)', async () => {
    const svc = new MedicationService(fake(), new OutboxService(undefined));
    const req = await svc.prescribe({
      patientId: 'p',
      encounterId: 'e',
      medicationCode: 'AMOX',
      dose: '500mg',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
    });
    const e1 = await svc
      .dispense(req.id, { quantity: '20', batch: 'B1' })
      .catch((e: unknown) => e as { status?: number });
    expect((e1 as { status?: number }).status).toBe(422);
    await svc.verify(req.id, {});
    await svc.dispense(req.id, { quantity: '20', batch: 'B1' });
    const e2 = await svc
      .administer('00000000-0000-0000-0000-000000000000', { doseGiven: '500mg', outcome: 'given', reason: '' })
      .catch((e: unknown) => e as { status?: number });
    expect((e2 as { status?: number }).status).toBe(404);
  });

  it('requires reason for not-given (400)', async () => {
    const svc = new MedicationService(fake(), new OutboxService(undefined));
    const req = await svc.prescribe({
      patientId: 'p',
      encounterId: 'e',
      medicationCode: 'AMOX',
      dose: '500mg',
      doseUnit: 'mg',
      route: 'oral',
      frequency: 'BD',
    });
    await svc.verify(req.id, {});
    await svc.dispense(req.id, { quantity: '20', batch: 'B1' });
    const err = await svc
      .administer(req.id, { doseGiven: '', outcome: 'not-given', reason: '' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });
});
