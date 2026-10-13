import { EmergencyService } from './emergency.service.js';
import { orderWaitingList } from '../domain/emergency.repository.js';
import type { EmergencyRepository } from '../domain/emergency.repository.js';
import type { EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import type { EncounterService } from '../../encounter/application/encounter.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('orderWaitingList (pure)', () => {
  it('sorts acuity first, then arrival; unscored last', () => {
    const ordered = orderWaitingList(
      [
        { encounterId: 'a', acuity: 4, arrivedAt: '2026-01-01T08:00:00.000Z' },
        { encounterId: 'b', arrivedAt: '2026-01-01T07:00:00.000Z' },
        { encounterId: 'c', acuity: 1, arrivedAt: '2026-01-01T09:00:00.000Z' },
        { encounterId: 'd', acuity: 1, arrivedAt: '2026-01-01T08:30:00.000Z' },
      ],
      new Date('2026-01-01T10:00:00.000Z'),
    );
    expect(ordered.map((e) => e.encounterId)).toEqual(['d', 'c', 'a', 'b']);
    expect(ordered[0]?.waitingMinutes).toBe(90);
  });
});

describe('EmergencyService (unit, fakes)', () => {
  function fakes(status: 'open' | 'admitted' = 'open', acuityLevel?: 1 | 2 | 3 | 4 | 5) {
    const emergency: EmergencyRepository = {
      recordAcuity: async () => ({ id: 'ac1' }),
      latestAcuity: async () =>
        acuityLevel
          ? { encounterId: 'e1', level: acuityLevel, discriminator: 'x', recordedAt: '' }
          : undefined,
      waitingList: async () => [],
    };
    const encounters = {
      findById: async () => ({
        id: 'e1', patientId: 'p1', facilityId: 'f1', type: 'emergency' as const, status,
      }),
    } as unknown as EncounterRepository;
    const encounterService = {
      discharge: async () => ({ id: 'e1', status: 'discharged' }),
    } as unknown as EncounterService;
    return { emergency, encounters, encounterService };
  }

  function svc(f: ReturnType<typeof fakes>) {
    return new EmergencyService(
      f.emergency,
      f.encounters,
      f.encounterService,
      new OutboxService(undefined),
    );
  }

  it('refuses acuity on non-emergency encounters (422)', async () => {
    const f = fakes();
    f.encounters.findById = async () => ({
      id: 'e1', patientId: 'p1', facilityId: 'f1', type: 'outpatient' as const, status: 'open' as const,
    });
    const err = await svc(f)
      .score({ encounterId: 'e1', level: 2, discriminator: 'severe pain' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('requires acuity before emergency disposition (422)', async () => {
    const err = await svc(fakes())
      .dischargeWithAcuity('e1', {})
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('discharges once scored', async () => {
    const res = await svc(fakes('open', 2)).dischargeWithAcuity('e1', {});
    expect(res).toMatchObject({ id: 'e1' });
  });
});
