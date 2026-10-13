import { EncounterService } from './encounter.service.js';
import { transition } from '../domain/encounter.repository.js';
import type { EncounterRepository } from '../domain/encounter.repository.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transition (pure ADT machine)', () => {
  it('open -> admit/cancel/discharge(outpatient)', () => {
    expect(transition('open', 'admit', 'inpatient')).toBe('admitted');
    expect(transition('open', 'cancel', 'inpatient')).toBe('cancelled');
    expect(transition('open', 'discharge', 'outpatient')).toBe('discharged');
    expect(transition('open', 'discharge', 'emergency')).toBe('discharged');
  });

  it('inpatient open cannot discharge directly; admitted can transfer/discharge', () => {
    expect(() => transition('open', 'discharge', 'inpatient')).toThrow(
      'ENCOUNTER_TRANSITION',
    );
    expect(transition('admitted', 'transfer', 'inpatient')).toBe('admitted');
    expect(transition('admitted', 'discharge', 'inpatient')).toBe('discharged');
  });

  it('terminal states reject everything; open rejects transfer', () => {
    expect(() => transition('discharged', 'admit', 'inpatient')).toThrow(
      'ENCOUNTER_TRANSITION',
    );
    expect(() => transition('cancelled', 'discharge', 'outpatient')).toThrow(
      'ENCOUNTER_TRANSITION',
    );
    expect(() => transition('open', 'transfer', 'inpatient')).toThrow(
      'ENCOUNTER_TRANSITION',
    );
    expect(() => transition('admitted', 'admit', 'inpatient')).toThrow(
      'ENCOUNTER_TRANSITION',
    );
  });
});

describe('EncounterService (unit, fakes)', () => {
  const patient: PatientRepository = {
    create: async () => {
      throw new Error('not used');
    },
    findById: async () => ({
      id: 'p1',
      familyName: 'Doe',
      givenName: 'Jane',
      dateOfBirth: '1990-01-01',
      sex: 'F',
      facilityId: 'f1',
      status: 'active',
      identifiers: [],
    }),
    search: async () => [],
    listFacilityPatients: async () => [],
      merge: async () => undefined,
      findMergeTarget: async () => undefined,
      setGuarantor: async () => undefined,
      findByIdentifierValue: async () => [],
  };

  function encounterRepo(over: Partial<EncounterRepository> = {}): EncounterRepository {
    return {
      open: async (input) => ({
        id: 'e1',
        patientId: input.patientId,
        facilityId: input.facilityId,
        type: input.type,
        status: 'open',
      }),
      findById: async () => ({
        id: 'e1',
        patientId: 'p1',
        facilityId: 'f1',
        type: 'inpatient',
        status: 'open',
      }),
      applyTransition: async (input) => ({
        id: input.id,
        patientId: 'p1',
        facilityId: 'f1',
        type: 'inpatient',
        status: input.status,
      }),
      listHistory: async () => [],
      setCoverage: async () => undefined,
      listActive: async () => [],
      ...over,
    };
  }

  it('refuses encounter for retired-duplicate patient', async () => {
    const retired: PatientRepository = {
      ...patient,
      findById: async () => ({
        id: 'p1',
        familyName: 'Doe',
        givenName: 'Jane',
        dateOfBirth: '1990-01-01',
        sex: 'F',
        facilityId: 'f1',
        status: 'retired-duplicate',
        identifiers: [],
      }),
    };
    const svc = new EncounterService(
      encounterRepo(),
      retired,
      new OutboxService(undefined),
    );
    await expect(
      svc.open({ patientId: 'p1', facilityId: 'f1', type: 'inpatient' }),
    ).rejects.toThrow('retired-duplicate');
  });

  it('rejects illegal transition as 422 with code', async () => {
    const svc = new EncounterService(
      encounterRepo(),
      patient,
      new OutboxService(undefined),
    );
    const err = await svc
      .discharge('e1', {})
      .catch((e: unknown) => e as { status?: number; response?: { code?: string } });
    expect((err as { status?: number }).status).toBe(422);
  });
});
