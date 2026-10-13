import { BloodbankService } from './bloodbank.service.js';
import { isCompatible, transitionUnit } from '../domain/bloodbank.repository.js';
import type { ABO, BloodbankRepository, Rh } from '../domain/bloodbank.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

const ABOS: ABO[] = ['O', 'A', 'B', 'AB'];

describe('isCompatible (exhaustive ABO/Rh matrix)', () => {
  it('O- is universal donor; AB+ universal recipient', () => {
    for (const abo of ABOS) {
      for (const rh of ['+', '-'] as Rh[]) {
        expect(isCompatible({ abo: 'O', rh: '-' }, { abo, rh })).toBe(true);
        expect(isCompatible({ abo, rh }, { abo: 'AB', rh: '+' })).toBe(true);
      }
    }
  });

  it('Rh-negative never receives Rh-positive', () => {
    for (const abo of ABOS) {
      expect(isCompatible({ abo, rh: '+' }, { abo, rh: '-' })).toBe(false);
    }
  });

  it('ABO rules: O gives to all, AB takes from all, A/B do not cross', () => {
    expect(isCompatible({ abo: 'A', rh: '-' }, { abo: 'B', rh: '-' })).toBe(false);
    expect(isCompatible({ abo: 'B', rh: '-' }, { abo: 'A', rh: '-' })).toBe(false);
    expect(isCompatible({ abo: 'AB', rh: '-' }, { abo: 'O', rh: '-' })).toBe(false);
    expect(isCompatible({ abo: 'O', rh: '-' }, { abo: 'AB', rh: '-' })).toBe(true);
    expect(isCompatible({ abo: 'A', rh: '+', }, { abo: 'A', rh: '+' })).toBe(true);
  });
});

describe('transitionUnit', () => {
  it('collected -> tested -> available -> reserved/issued -> transfused', () => {
    expect(transitionUnit('collected', 'test')).toBe('tested');
    expect(transitionUnit('tested', 'release')).toBe('available');
    expect(transitionUnit('available', 'reserve')).toBe('reserved');
    expect(transitionUnit('reserved', 'issue')).toBe('issued');
    expect(transitionUnit('issued', 'transfuse')).toBe('transfused');
    expect(() => transitionUnit('collected', 'issue')).toThrow('BANK_TRANSITION');
  });
});

describe('BloodbankService (unit, fake repo)', () => {
  function fake(abo: ABO = 'O', rh: Rh = '-') {
    const repo: BloodbankRepository = {
      registerUnit: async () => ({ id: 'u1' }),
      findUnit: async () => ({ id: 'u1', abo, rh, status: 'available' as const }),
      setUnitStatus: async () => undefined,
      recordCrossmatch: async () => ({ id: 'x1' }),
      latestCrossmatch: async () => ({ result: 'compatible' }),
      startTransfusion: async () => ({ id: 't1' }),
      finishTransfusion: async () => undefined,
    };
    return repo;
  }

  function svc(repo: BloodbankRepository) {
    return new BloodbankService(repo, new OutboxService(undefined));
  }

  it('records then refuses incompatible crossmatch (422)', async () => {
    let recorded = '';
    const repo = fake('AB', '+');
    repo.recordCrossmatch = async () => {
      recorded = 'incompatible';
      return { id: 'x1' };
    };
    const err = await svc(repo)
      .crossmatch({ patientId: 'p1', unitId: 'u1', recipientAbo: 'O', recipientRh: '-' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
    expect(recorded).toBe('incompatible');
  });

  it('requires a reaction note when stopping (400)', async () => {
    const err = await svc(fake())
      .finishTransfusion('t1', { reaction: 'severe' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });
});
