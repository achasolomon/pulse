import { RosterService } from './roster.service.js';
import type {
  Assignment,
  AssignmentKind,
  RosterRepository,
  Shift,
  Staff,
  StaffRole,
} from '../domain/roster.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

const FAC = '00000000-0000-4000-8000-0000000000fa';

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

function store(opts: { inactive?: boolean } = {}) {
  const staff = new Map<string, Staff>();
  const shifts = new Map<string, Shift>();
  const assignments = new Map<string, Assignment>();
  let seq = 0;
  const uid = (p: string) => `00000000-0000-4000-8000-00000000${p}${String(seq).padStart(2, '0')}`;

  const repo: RosterRepository = {
    createStaff: async (input) => {
      seq += 1;
      const s: Staff = {
        id: uid('5'),
        facilityId: input.facilityId,
        displayName: input.displayName,
        role: input.role,
        contact: input.contact,
        active: !opts.inactive,
      };
      staff.set(s.id, s);
      return s;
    },
    getStaff: async (id) => staff.get(id),
    listStaff: async (filter) =>
      [...staff.values()].filter(
        (s) =>
          (!filter.facilityId || s.facilityId === filter.facilityId) &&
          (filter.active === undefined || s.active === filter.active),
      ),
    createShift: async (input) => {
      seq += 1;
      const sh: Shift = {
        id: uid('7'),
        staffId: input.staffId,
        facilityId: input.facilityId,
        kind: input.kind,
        ...(input.unit ? { unit: input.unit } : {}),
        startsAt: new Date(input.startsAt).toISOString(),
        endsAt: new Date(input.endsAt).toISOString(),
        status: 'scheduled',
      };
      shifts.set(sh.id, sh);
      return sh;
    },
    getShift: async (id) => shifts.get(id),
    listShifts: async (filter) =>
      [...shifts.values()]
        .filter(
          (s) =>
            (!filter.staffId || s.staffId === filter.staffId) &&
            (!filter.facilityId || s.facilityId === filter.facilityId) &&
            (!filter.status || s.status === filter.status) &&
            (!filter.kind || s.kind === filter.kind) &&
            (!filter.from || new Date(s.startsAt) >= filter.from) &&
            (!filter.to || new Date(s.startsAt) < filter.to),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    listShiftsInRange: async (staffId, from, to) =>
      [...shifts.values()]
        .filter(
          (s) =>
            s.staffId === staffId &&
            s.status === 'scheduled' &&
            new Date(s.startsAt) < to &&
            new Date(s.endsAt) > from,
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    updateShift: async (id, input) => {
      shifts.get(id)!.status = input.status;
    },
    createAssignment: async (input) => {
      seq += 1;
      const a: Assignment = {
        id: uid('9'),
        staffId: input.staffId,
        facilityId: input.facilityId,
        kind: input.kind,
        unit: input.unit,
        startsAt: new Date(input.startsAt).toISOString(),
        status: 'active',
      };
      assignments.set(a.id, a);
      return a;
    },
    getAssignment: async (id) => assignments.get(id),
    listAssignments: async (filter) =>
      [...assignments.values()].filter(
        (a) =>
          (!filter.staffId || a.staffId === filter.staffId) &&
          (!filter.facilityId || a.facilityId === filter.facilityId) &&
          (!filter.unit || a.unit === filter.unit) &&
          (!filter.status || a.status === filter.status),
      ),
    endAssignment: async (id, endsAt) => {
      const a = assignments.get(id)!;
      a.status = 'ended';
      a.endsAt = endsAt.toISOString();
    },
  };

  return {
    repo,
    svc: () => new RosterService(repo, new OutboxService(undefined)),
  };
}

const staffIn = { facilityId: FAC, displayName: 'Ada N', role: 'nurse' as StaffRole };

describe('RosterService (unit, fakes)', () => {
  it('scheduleShift guards: staff, window, length, overlap, fatigue', async () => {
    const s = store();
    const svc = s.svc();
    const staff = await svc.createStaff(staffIn);

    await expectCode(
      svc.scheduleShift({
        staffId: '00000000-0000-4000-8000-00000000dead',
        kind: 'day',
        startsAt: '2026-06-01T08:00:00Z',
        endsAt: '2026-06-01T16:00:00Z',
      }),
      'STAFF_NOT_FOUND',
      404,
    );
    await expectCode(
      svc.scheduleShift({
        staffId: staff.id,
        kind: 'day',
        startsAt: '2026-06-01T16:00:00Z',
        endsAt: '2026-06-01T08:00:00Z',
      }),
      'SHIFT_TIME_INVALID',
      422,
    );
    await expectCode(
      svc.scheduleShift({
        staffId: staff.id,
        kind: 'night',
        startsAt: '2026-06-02T08:00:00Z',
        endsAt: '2026-06-03T01:00:00Z',
      }),
      'SHIFT_TOO_LONG',
      422,
    );

    await svc.scheduleShift({
      staffId: staff.id,
      kind: 'day',
      startsAt: '2026-06-01T08:00:00Z',
      endsAt: '2026-06-01T16:00:00Z',
    });
    await expectCode(
      svc.scheduleShift({
        staffId: staff.id,
        kind: 'evening',
        startsAt: '2026-06-01T12:00:00Z',
        endsAt: '2026-06-01T18:00:00Z',
      }),
      'SHIFT_OVERLAP',
      409,
    );

    await svc.scheduleShift({
      staffId: staff.id,
      kind: 'night',
      startsAt: '2026-06-02T20:00:00Z',
      endsAt: '2026-06-03T08:00:00Z',
    });
    await expectCode(
      svc.scheduleShift({
        staffId: staff.id,
        kind: 'day',
        startsAt: '2026-06-03T10:00:00Z',
        endsAt: '2026-06-03T18:00:00Z',
      }),
      'FATIGUE_LIMIT',
      422,
    );
    const ok = await svc.scheduleShift({
      staffId: staff.id,
      kind: 'day',
      startsAt: '2026-06-05T08:00:00Z',
      endsAt: '2026-06-05T16:00:00Z',
    });
    expect(ok.status).toBe('scheduled');
  });

  it('inactive staff refused; on-call primary needs overlapping secondary', async () => {
    const s = store({ inactive: true });
    const svc = s.svc();
    const staff = await svc.createStaff(staffIn);
    await expectCode(
      svc.scheduleShift({
        staffId: staff.id,
        kind: 'day',
        startsAt: '2026-06-01T08:00:00Z',
        endsAt: '2026-06-01T16:00:00Z',
      }),
      'STAFF_INACTIVE',
      409,
    );

    const s2 = store();
    const svc2 = s2.svc();
    const primary = await svc2.createStaff({ ...staffIn, displayName: 'Bob M', role: 'doctor' });
    const secondary = await svc2.createStaff({ ...staffIn, displayName: 'Cara L', role: 'doctor' });

    await expectCode(
      svc2.scheduleShift({
        staffId: primary.id,
        kind: 'on_call_primary',
        startsAt: '2026-06-10T08:00:00Z',
        endsAt: '2026-06-10T20:00:00Z',
      }),
      'NO_SECONDARY_COVERAGE',
      422,
    );
    await svc2.scheduleShift({
      staffId: secondary.id,
      kind: 'on_call_secondary',
      startsAt: '2026-06-10T08:00:00Z',
      endsAt: '2026-06-10T20:00:00Z',
    });
    const onCall = await svc2.scheduleShift({
      staffId: primary.id,
      kind: 'on_call_primary',
      startsAt: '2026-06-10T10:00:00Z',
      endsAt: '2026-06-10T18:00:00Z',
    });
    expect(onCall.kind).toBe('on_call_primary');

    const now = await svc2.onCallNow(FAC, '2026-06-10T12:00:00Z');
    expect(now.map((x) => x.kind).sort()).toEqual(['on_call_primary', 'on_call_secondary']);
    const later = await svc2.onCallNow(FAC, '2026-06-10T22:00:00Z');
    expect(later).toHaveLength(0);
  });

  it('shift transitions are terminal; unknown ids 404', async () => {
    const s = store();
    const svc = s.svc();
    const staff = await svc.createStaff(staffIn);
    const shift = await svc.scheduleShift({
      staffId: staff.id,
      kind: 'day',
      startsAt: '2026-06-01T08:00:00Z',
      endsAt: '2026-06-01T16:00:00Z',
    });
    const done = await svc.transitionShift(shift.id, 'completed');
    expect(done.status).toBe('completed');
    await expectCode(svc.transitionShift(shift.id, 'cancelled'), 'SHIFT_STATE_INVALID', 409);
    await expectCode(svc.transitionShift(shift.id, 'completed'), 'SHIFT_STATE_INVALID', 409);
    await expectCode(
      svc.transitionShift('00000000-0000-4000-8000-00000000dead', 'cancelled'),
      'SHIFT_NOT_FOUND',
      404,
    );
  });

  it('assignments: create, list by unit, end is terminal', async () => {
    const s = store();
    const svc = s.svc();
    const staff = await svc.createStaff(staffIn);
    const a = await svc.createAssignment({
      staffId: staff.id,
      kind: 'primary',
      unit: 'Ward A',
    });
    expect(a.status).toBe('active');
    const list = await svc.listAssignments({ unit: 'Ward A', status: 'active' });
    expect(list.map((x) => x.id)).toContain(a.id);

    const ended = await svc.endAssignment(a.id);
    expect(ended.status).toBe('ended');
    expect(ended.endsAt).toBeDefined();
    await expectCode(svc.endAssignment(a.id), 'ASSIGNMENT_STATE_INVALID', 409);
    await expectCode(
      svc.endAssignment('00000000-0000-4000-8000-00000000dead'),
      'ASSIGNMENT_NOT_FOUND',
      404,
    );
    const kind: AssignmentKind = 'cross_cover';
    const cross = await svc.createAssignment({
      staffId: staff.id,
      kind,
      unit: 'Ward B',
      startsAt: '2026-06-01T08:00:00Z',
    });
    expect(cross.status).toBe('active');
    const all = await svc.listAssignments({ staffId: staff.id });
    expect(all.length).toBe(2);
  });
});
