import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyRosterRepository } from './../src/modules/roster/infrastructure/kysely-roster.repository.js';
import { RosterService } from './../src/modules/roster/application/roster.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

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

describe.skipIf(!hasDb)('roster workforce (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let roster: RosterService;
  let facilityId: string;
  let nurseId: string;
  let doctorId: string;
  const RUN = `R${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    roster = new RosterService(new KyselyRosterRepository(db), new OutboxService(db));

    const org = await db
      .insertInto('org.organization')
      .values({ name: `Roster Org ${RUN}`, code: RUN.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'General Ward', code: `W${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;

    const nurse = await roster.createStaff({
      facilityId,
      displayName: `Nurse ${RUN}`,
      role: 'nurse',
      contact: `+1000${RUN}`,
    });
    nurseId = nurse.id;
    const doctor = await roster.createStaff({
      facilityId,
      displayName: `Doctor ${RUN}`,
      role: 'doctor',
    });
    doctorId = doctor.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('shifts: overlap, length, fatigue guards; completion terminal; outbox events', async () => {
    const day = await roster.scheduleShift({
      staffId: nurseId,
      kind: 'day',
      unit: 'Ward A',
      startsAt: '2027-03-01T08:00:00.000Z',
      endsAt: '2027-03-01T16:00:00.000Z',
    });
    expect(day.status).toBe('scheduled');

    await expectCode(
      roster.scheduleShift({
        staffId: nurseId,
        kind: 'evening',
        startsAt: '2027-03-01T12:00:00.000Z',
        endsAt: '2027-03-01T18:00:00.000Z',
      }),
      'SHIFT_OVERLAP',
      409,
    );
    await expectCode(
      roster.scheduleShift({
        staffId: nurseId,
        kind: 'night',
        startsAt: '2027-03-02T08:00:00.000Z',
        endsAt: '2027-03-03T01:00:00.000Z',
      }),
      'SHIFT_TOO_LONG',
      422,
    );
    await roster.scheduleShift({
      staffId: nurseId,
      kind: 'night',
      startsAt: '2027-03-02T20:00:00.000Z',
      endsAt: '2027-03-03T08:00:00.000Z',
    });
    await expectCode(
      roster.scheduleShift({
        staffId: nurseId,
        kind: 'day',
        startsAt: '2027-03-03T10:00:00.000Z',
        endsAt: '2027-03-03T18:00:00.000Z',
      }),
      'FATIGUE_LIMIT',
      422,
    );
    const later = await roster.scheduleShift({
      staffId: nurseId,
      kind: 'day',
      startsAt: '2027-03-05T08:00:00.000Z',
      endsAt: '2027-03-05T16:00:00.000Z',
    });
    expect(later.status).toBe('scheduled');

    const done = await roster.transitionShift(day.id, 'completed');
    expect(done.status).toBe('completed');
    await expectCode(roster.transitionShift(day.id, 'cancelled'), 'SHIFT_STATE_INVALID', 409);
    await expectCode(roster.transitionShift(day.id, 'completed'), 'SHIFT_STATE_INVALID', 409);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_id', 'in', [nurseId, day.id, done.id, later.id])
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'roster.staff_created',
        'roster.shift_scheduled',
        'roster.shift_completed',
      ]),
    );
  });

  it('on-call rota: primary requires secondary; point-in-time query; cancel removes coverage', async () => {
    await expectCode(
      roster.scheduleShift({
        staffId: doctorId,
        kind: 'on_call_primary',
        startsAt: '2027-03-10T08:00:00.000Z',
        endsAt: '2027-03-10T20:00:00.000Z',
      }),
      'NO_SECONDARY_COVERAGE',
      422,
    );
    const secondary = await roster.scheduleShift({
      staffId: nurseId,
      kind: 'on_call_secondary',
      startsAt: '2027-03-10T08:00:00.000Z',
      endsAt: '2027-03-10T20:00:00.000Z',
    });
    const primary = await roster.scheduleShift({
      staffId: doctorId,
      kind: 'on_call_primary',
      startsAt: '2027-03-10T10:00:00.000Z',
      endsAt: '2027-03-10T18:00:00.000Z',
    });

    const now = await roster.onCallNow(facilityId, '2027-03-10T12:00:00.000Z');
    expect(now.map((s) => s.kind).sort()).toEqual(['on_call_primary', 'on_call_secondary']);
    const outside = await roster.onCallNow(facilityId, '2027-03-10T22:00:00.000Z');
    expect(outside).toHaveLength(0);

    await roster.transitionShift(secondary.id, 'cancelled');
    const afterCancel = await roster.onCallNow(facilityId, '2027-03-10T12:00:00.000Z');
    expect(afterCancel.map((s) => s.kind)).toEqual(['on_call_primary']);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_id', 'in', [secondary.id, primary.id])
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'roster.shift_scheduled',
        'roster.shift_cancelled',
      ]),
    );
  });

  it('assignments: ward primary + cross-cover scoped, end is terminal', async () => {
    const primary = await roster.createAssignment({
      staffId: nurseId,
      kind: 'primary',
      unit: `Ward ${RUN}`,
    });
    expect(primary.status).toBe('active');
    const cross = await roster.createAssignment({
      staffId: doctorId,
      kind: 'cross_cover',
      unit: `Ward ${RUN}`,
      startsAt: '2027-03-01T08:00:00.000Z',
    });

    const active = await roster.listAssignments({ unit: `Ward ${RUN}`, status: 'active' });
    expect(active.map((a) => a.id).sort()).toEqual([primary.id, cross.id].sort());

    const ended = await roster.endAssignment(primary.id);
    expect(ended.status).toBe('ended');
    expect(ended.endsAt).toBeDefined();
    await expectCode(roster.endAssignment(primary.id), 'ASSIGNMENT_STATE_INVALID', 409);

    const stillActive = await roster.listAssignments({ unit: `Ward ${RUN}`, status: 'active' });
    expect(stillActive.map((a) => a.id)).toEqual([cross.id]);

    await expectCode(
      roster.endAssignment('00000000-0000-4000-8000-00000000d00e'),
      'ASSIGNMENT_NOT_FOUND',
      404,
    );
    await expectCode(roster.getStaff('00000000-0000-4000-8000-00000000d00f'), 'STAFF_NOT_FOUND', 404);
  });
});
