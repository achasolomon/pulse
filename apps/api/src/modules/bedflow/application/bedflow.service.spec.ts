import { BedflowService } from './bedflow.service.js';
import type {
  Bed,
  BedAssignment,
  BedflowRepository,
  LevelOfCare,
} from '../domain/bedflow.repository.js';
import type { Encounter, EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

const FAC = '00000000-0000-4000-8000-0000000000fa';
const ENC = '00000000-0000-4000-8000-00000000e001';

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

function store(opts: { encounter?: Partial<Encounter> | null } = {}) {
  const beds = new Map<string, Bed>();
  const assignments = new Map<string, BedAssignment>();
  const levels = new Map<string, LevelOfCare>();
  let seq = 0;
  const uid = (p: string) => `00000000-0000-4000-8000-00000000${p}${String(seq).padStart(2, '0')}`;

  const repo: BedflowRepository = {
    getLocation: async (id) => beds.get(id),
    configureBed: async (id, input) => {
      const b = beds.get(id)!;
      b.levelOfCare = input.levelOfCare;
      b.isolationCapable = input.isolationCapable;
    },
    setOutOfService: async (id, input) => {
      const b = beds.get(id)!;
      b.outOfService = input.outOfService;
      b.outOfServiceReason = input.outOfService ? input.reason : undefined;
    },
    listBeds: async (filter) =>
      [...beds.values()].filter(
        (b) => b.facilityId === filter.facilityId && (!filter.level || b.levelOfCare === filter.level),
      ),
    createAssignment: async (input) => {
      seq += 1;
      const a: BedAssignment = {
        id: uid('a'),
        locationId: input.locationId,
        encounterId: input.encounterId,
        facilityId: input.facilityId,
        status: 'active',
        startsAt: new Date().toISOString(),
      };
      assignments.set(a.id, a);
      return a;
    },
    getAssignment: async (id) => assignments.get(id),
    getActiveAssignmentByEncounter: async (encounterId) =>
      [...assignments.values()].find(
        (a) => a.encounterId === encounterId && a.status === 'active',
      ),
    getActiveAssignmentByBed: async (locationId) =>
      [...assignments.values()].find(
        (a) => a.locationId === locationId && a.status === 'active',
      ),
    listAssignments: async (filter) =>
      [...assignments.values()].filter(
        (a) =>
          (!filter.facilityId || a.facilityId === filter.facilityId) &&
          (!filter.encounterId || a.encounterId === filter.encounterId) &&
          (!filter.status || a.status === filter.status),
      ),
    endAssignment: async (id, endedAt) => {
      const a = assignments.get(id)!;
      a.status = 'ended';
      a.endedAt = endedAt.toISOString();
    },
    getActiveLevel: async (encounterId) =>
      [...levels.values()].find((l) => l.encounterId === encounterId && l.status === 'active'),
    listLevels: async (encounterId) =>
      [...levels.values()]
        .filter((l) => l.encounterId === encounterId)
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    createLevel: async (input) => {
      seq += 1;
      const l: LevelOfCare = {
        id: uid('l'),
        encounterId: input.encounterId,
        level: input.level,
        reason: input.reason,
        status: 'active',
        startsAt: new Date(Date.now() + seq).toISOString(),
      };
      levels.set(l.id, l);
      return l;
    },
    endActiveLevel: async (encounterId) => {
      for (const l of levels.values()) {
        if (l.encounterId === encounterId && l.status === 'active') {
          l.status = 'ended';
          l.endedAt = new Date().toISOString();
        }
      }
    },
  };

  const encounters: EncounterRepository = {
    open: async () => {
      throw new Error('not used');
    },
    findById: async (id) =>
      id === ENC && opts.encounter !== null
        ? ({
            id: ENC,
            patientId: '00000000-0000-4000-8000-00000000p001',
            facilityId: FAC,
            type: 'inpatient',
            status: 'admitted',
            ...opts.encounter,
          } as Encounter)
        : undefined,
    applyTransition: async () => {
      throw new Error('not used');
    },
    listHistory: async () => [],
    setCoverage: async () => undefined,
    listActive: async () => [],
  };

  return {
    beds,
    repo,
    encounters,
    svc: () => new BedflowService(repo, encounters, new OutboxService(undefined)),
  };
}

function bed(id: string, extra: Partial<Bed> = {}): Bed {
  return {
    id,
    unitId: '00000000-0000-4000-8000-00000000u001',
    facilityId: FAC,
    name: `Bed ${id}`,
    code: id.slice(-4),
    isolationCapable: false,
    outOfService: false,
    ...extra,
  };
}

describe('BedflowService (unit, fakes)', () => {
  it('configure guards non-bed locations; oos guard on occupied', async () => {
    const s = store();
    s.beds.set('00000000-0000-4000-8000-00000000b001', bed('00000000-0000-4000-8000-00000000b001'));
    const svc = s.svc();

    const configured = await svc.configureBed('00000000-0000-4000-8000-00000000b001', {
      levelOfCare: 'ward',
    });
    expect(configured.levelOfCare).toBe('ward');

    await expectCode(
      svc.configureBed('00000000-0000-4000-8000-00000000b0ff', { levelOfCare: 'icu' }),
      'BED_NOT_FOUND',
      404,
    );

    await svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b001' });
    await expectCode(
      svc.setOutOfService('00000000-0000-4000-8000-00000000b001', { reason: 'Cleaning cycle' }),
      'BED_OCCUPIED',
      409,
    );
  });

  it('assign: level gate, facility, occupied, already-in-bed; transfer; release', async () => {
    const s = store();
    s.beds.set('00000000-0000-4000-8000-00000000b001', bed('00000000-0000-4000-8000-00000000b001', { levelOfCare: 'ward' }));
    s.beds.set('00000000-0000-4000-8000-00000000b002', bed('00000000-0000-4000-8000-00000000b002', { levelOfCare: 'icu' }));
    s.beds.set('00000000-0000-4000-8000-00000000b003', bed('00000000-0000-4000-8000-00000000b003', { levelOfCare: 'icu' }));
    s.beds.set('00000000-0000-4000-8000-00000000b004', bed('00000000-0000-4000-8000-00000000b004', { levelOfCare: 'ward', facilityId: '00000000-0000-4000-8000-00000000f002' }));
    s.beds.set('00000000-0000-4000-8000-00000000b005', bed('00000000-0000-4000-8000-00000000b005'));
    const svc = s.svc();

    await expectCode(
      svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b002' }),
      'LEVEL_OF_CARE_REQUIRED',
      422,
    );
    await svc.setLevelOfCare({ encounterId: ENC, level: 'icu', reason: 'Post-op escalation' });
    await expectCode(
      svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b004' }),
      'FACILITY_MISMATCH',
      422,
    );
    await expectCode(
      svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b005' }),
      'BED_LEVEL_UNSET',
      422,
    );

    const a = await svc.assignBed({
      encounterId: ENC,
      locationId: '00000000-0000-4000-8000-00000000b002',
    });
    expect(a.status).toBe('active');

    await expectCode(
      svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b003' }),
      'ENCOUNTER_ALREADY_IN_BED',
      409,
    );

    const moved = await svc.transferBed({
      encounterId: ENC,
      locationId: '00000000-0000-4000-8000-00000000b003',
    });
    expect(moved.locationId).toBe('00000000-0000-4000-8000-00000000b003');
    const old = await s.repo.getAssignment(a.id);
    expect(old?.status).toBe('ended');

    const released = await svc.releaseBed({ encounterId: ENC });
    expect(released.status).toBe('ended');
    await expectCode(svc.releaseBed({ encounterId: ENC }), 'NO_ACTIVE_ASSIGNMENT', 409);
    await expectCode(
      svc.transferBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b002' }),
      'NO_ACTIVE_ASSIGNMENT',
      409,
    );
  });

  it('occupied and discharged guards; level history keeps prior rows', async () => {
    const s = store();
    s.beds.set('00000000-0000-4000-8000-00000000b001', bed('00000000-0000-4000-8000-00000000b001', { levelOfCare: 'ward' }));
    const svc = s.svc();

    await expectCode(
      svc.assignBed({ encounterId: '00000000-0000-4000-8000-00000000e0ff', locationId: '00000000-0000-4000-8000-00000000b001' }),
      'ENCOUNTER_NOT_ACTIVE',
      409,
    );

    const s2 = store({ encounter: { status: 'discharged' } });
    s2.beds.set('00000000-0000-4000-8000-00000000b001', bed('00000000-0000-4000-8000-00000000b001', { levelOfCare: 'ward' }));
    await expectCode(
      s2.svc().assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b001' }),
      'ENCOUNTER_NOT_ACTIVE',
      409,
    );

    const svc3 = s.svc();
    await svc3.setLevelOfCare({ encounterId: ENC, level: 'icu', reason: 'Respiratory failure' });
    await svc3.setLevelOfCare({ encounterId: ENC, level: 'ward', reason: 'Stepped down after improvement' });
    const lvl = await svc3.getLevelOfCare(ENC);
    expect(lvl.current?.level).toBe('ward');
    expect(lvl.effective).toBe('ward');
    expect(lvl.history.filter((h) => h.status === 'ended')).toHaveLength(1);
    await expectCode(
      svc3.setLevelOfCare({ encounterId: ENC, level: 'hdu', reason: 'x' }),
      'LEVEL_REASON_REQUIRED',
      422,
    );
  });

  it('available list filters out-of-service and occupied beds', async () => {
    const s = store();
    s.beds.set('00000000-0000-4000-8000-00000000b001', bed('00000000-0000-4000-8000-00000000b001', { levelOfCare: 'ward' }));
    s.beds.set('00000000-0000-4000-8000-00000000b002', bed('00000000-0000-4000-8000-00000000b002', { levelOfCare: 'ward', outOfService: true, outOfServiceReason: 'Maintenance' }));
    s.beds.set('00000000-0000-4000-8000-00000000b003', bed('00000000-0000-4000-8000-00000000b003', { levelOfCare: 'ward', isolationCapable: true }));
    const svc = s.svc();
    await svc.assignBed({ encounterId: ENC, locationId: '00000000-0000-4000-8000-00000000b001' });

    const available = await svc.listAvailableBeds(FAC, { level: 'ward' });
    expect(available.map((b) => b.id)).toEqual(['00000000-0000-4000-8000-00000000b003']);

    const isolation = await svc.listAvailableBeds(FAC, { isolation: true });
    expect(isolation.map((b) => b.id)).toEqual(['00000000-0000-4000-8000-00000000b003']);

    const all = await svc.listBeds(FAC);
    expect(all).toHaveLength(3);
  });
});
