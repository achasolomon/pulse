import { SyncService } from './sync.service.js';
import { decodeCursor, encodeCursor } from '../domain/sync.repository.js';
import type { SyncRepository } from '../domain/sync.repository.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import type { EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import type { ClinicalRepository } from '../../clinical/domain/clinical.repository.js';
import type { PatientService } from '../../patient/application/patient.service.js';
import type { EncounterService } from '../../encounter/application/encounter.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('sync cursor codec', () => {
  it('round-trips; empty decodes to beginning; garbage throws', () => {
    expect(decodeCursor('')).toEqual({});
    const c = { lastCreatedAt: '2026-01-01T00:00:00.000Z', lastId: 'x' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow('SYNC_CURSOR_INVALID');
  });
});

describe('SyncService apply (unit, fakes)', () => {
  function repos(applied = new Set<string>()) {
    const sync: SyncRepository = {
      feed: async () => ({ events: [], cursor: {} }),
      isApplied: async (id) => applied.has(id),
      markApplied: async (id) => {
        applied.add(id);
      },
      openConflict: async () => ({ id: 'cf1' }),
      resolveConflict: async () => undefined,
      findOpen: async () => [],
      watermark: async () => ({}),
      saveWatermark: async () => undefined,
    };
    const patients = {
      listFacilityPatients: async () => [],
    } as unknown as PatientRepository;
    const encounters = {} as unknown as EncounterRepository;
    const clinical = {
      recordObservation: async () => ({ id: 'o1' }),
    } as unknown as ClinicalRepository;
    const patientService = {
      register: async () => ({ patient: { id: 'p1' }, duplicates: [] }),
    } as unknown as PatientService;
    const encounterService = {} as unknown as EncounterService;
    return { sync, patients, encounters, clinical, patientService, encounterService };
  }

  function svc(r: ReturnType<typeof repos>) {
    return new SyncService(
      r.sync,
      r.patients,
      r.encounters,
      r.clinical,
      r.patientService,
      r.encounterService,
      new OutboxService(undefined),
    );
  }

  const evt = (over: Record<string, unknown> = {}) => ({
    eventId: '11111111-1111-4111-8111-111111111111',
    type: 'observation.recorded',
    aggregateId: 'a1',
    occurredAt: new Date().toISOString(),
    payload: { patientId: 'p1', code: 'BP_SYS', valueNum: 120 } as Record<string, unknown>,
    ...over,
  });

  it('rejects non-UUID event ids', async () => {
    const s = svc(repos());
    await expect(s.apply([evt({ eventId: 'not-a-uuid' })], {})).rejects.toThrow(
      'SYNC_EVENT_ID_INVALID',
    );
  });

  it('applies once then skips replays', async () => {
    const applied = new Set<string>();
    const s = svc(repos(applied));
    const first = await s.apply([evt()], {});
    expect(first).toEqual({
      applied: ['11111111-1111-4111-8111-111111111111'],
      conflicts: [],
      skipped: [],
    });
    const second = await s.apply([evt()], {});
    expect(second.skipped).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('routes unknown types to conflict, never throws', async () => {
    const s = svc(repos());
    const res = await s.apply([evt({ type: 'alien.probe', payload: {} })], {});
    expect(res.conflicts).toHaveLength(1);
  });

  it('capability enforcement: out-of-scope type rejects the WHOLE batch before any write', async () => {
    const applied = new Set<string>();
    const r = repos(applied);
    const s = svc(r);
    const denied = await s
      .apply(
        [
          evt(),
          evt({
            eventId: '22222222-2222-4222-8222-222222222222',
            type: 'patient.registered',
            payload: {},
          }),
        ],
        { capabilities: ['observation.'] },
      )
      .then(() => undefined)
      .catch((err: { getResponse: () => { code?: string } }) => err.getResponse());
    expect(denied?.code).toBe('SYNC_CAPABILITY_DENIED');
    expect(applied.size).toBe(0);
    // In-scope batch still applies.
    const ok = await s.apply([evt()], { capabilities: ['observation.'] });
    expect(ok.applied).toHaveLength(1);
    // Prefix and star capabilities.
    const prefixed = await s.apply(
      [evt({ eventId: '33333333-3333-4333-8333-333333333333' })],
      { capabilities: ['observation.'] },
    );
    expect(prefixed.applied).toHaveLength(1);
    const starred = await s.apply(
      [evt({ eventId: '44444444-4444-4444-8444-444444444444' })],
      { capabilities: ['*'] },
    );
    expect(starred.applied).toHaveLength(1);
  });

  it('feed passes capabilities through to the repository', async () => {
    let seen: string[] | undefined;
    const r = repos();
    const origFeed = r.sync.feed.bind(r.sync);
    r.sync.feed = async (since, limit, capabilities) => {
      seen = capabilities;
      return origFeed(since, limit, capabilities);
    };
    const s = svc(r);
    await s.feed('', 10, 'device:d1', ['observation.']);
    expect(seen).toEqual(['observation.']);
  });
});
