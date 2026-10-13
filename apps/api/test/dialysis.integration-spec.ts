import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyDialysisRepository } from './../src/modules/dialysis/infrastructure/kysely-dialysis.repository.js';
import { DialysisService } from './../src/modules/dialysis/application/dialysis.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
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

describe.skipIf(!hasDb)('dialysis recurring care (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let dialysis: DialysisService;
  let facilityId: string;
  let patientId: string;
  let protocolId: string;
  const RUN = `D${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    dialysis = new DialysisService(
      new KyselyDialysisRepository(db),
      patientRepo,
      outbox,
    );

    const code = `D${RUN}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Dial Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Renal Centre', code: `D${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const patients = new PatientService(patientRepo, outbox);
    patientId = (
      await patients.register({
        familyName: 'Dial', givenName: 'Pat', dateOfBirth: '1970-02-02',
        sex: 'M', facilityId, mrn: `DM${RUN}`,
      })
    ).patient.id;
    const protocol = await db
      .selectFrom('dial.protocol')
      .select(['id'])
      .where('code', '=', 'HD-STD')
      .executeTakeFirstOrThrow();
    protocolId = protocol.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('program -> schedule -> defer -> reschedule -> start -> complete with ultrafiltration', async () => {
    const program = await dialysis.createProgram({
      patientId, facilityId, protocolId,
      accessType: 'fistula', targetWeightKg: 68,
    });
    expect(program.status).toBe('active');

    const session = await dialysis.scheduleSession(program.id, {
      scheduledFor: '2026-10-20T09:00:00.000Z',
    });
    expect(session.status).toBe('scheduled');
    expect(session.protocolId).toBe(protocolId);

    // deferral needs a reason; deferred sessions can only reschedule or cancel
    await expectCode(dialysis.transitionSession(session.id, 'deferred'), 'DEFERRAL_REASON_REQUIRED', 400);
    await dialysis.transitionSession(session.id, 'deferred', { reason: `Machine down ${RUN}` });
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70, postWeightKg: 68 }),
      'SESSION_STATE_INVALID',
      409,
    );

    await dialysis.transitionSession(session.id, 'scheduled', {
      scheduledFor: '2026-10-21T09:00:00.000Z',
    });
    await dialysis.transitionSession(session.id, 'in_progress');
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70 }),
      'WEIGHT_REQUIRED',
      422,
    );
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70, postWeightKg: 73 }),
      'WEIGHTS_IMPLAUSIBLE',
      422,
    );
    const done = await dialysis.transitionSession(session.id, 'completed', {
      preWeightKg: 71.5, postWeightKg: 69.2, adverseEvent: `Cramp ${RUN}`,
    });
    expect(done.status).toBe('completed');
    expect(done.ultrafiltrationL).toBe(2.3);
    expect(done.adverseEvent).toBe(`Cramp ${RUN}`);

    // outbox evidence for lifecycle events
    const events = await db
      .selectFrom('integration.outbox')
      .select(['type', 'aggregate_id'])
      .where('aggregate_id', 'in', [program.id, session.id])
      .orderBy('created_at')
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'dialysis.program_created',
        'dialysis.session_scheduled',
        'dialysis.session_deferred',
        'dialysis.session_scheduled',
        'dialysis.session_in_progress',
        'dialysis.session_completed',
      ]),
    );
  });

  it('guards: facility mismatch, paused blocks start, closed blocks scheduling', async () => {
    const otherOrg = await db
      .insertInto('org.organization')
      .values({ name: `Dial Org2 ${RUN}`, code: `E${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const otherFac = await db
      .insertInto('org.facility')
      .values({ organization_id: otherOrg.id, name: 'Other', code: `F${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await expectCode(
      dialysis.createProgram({
        patientId, facilityId: otherFac.id, protocolId,
        accessType: 'fistula', targetWeightKg: 68,
      }),
      'PROGRAM_FACILITY_MISMATCH',
      422,
    );

    const program = await dialysis.createProgram({
      patientId, facilityId, protocolId,
      accessType: 'catheter', targetWeightKg: 70,
    });
    const session = await dialysis.scheduleSession(program.id, {
      scheduledFor: '2026-10-22T09:00:00.000Z',
    });

    await dialysis.setProgramStatus(program.id, 'paused');
    await expectCode(dialysis.transitionSession(session.id, 'in_progress'), 'PROGRAM_NOT_ACTIVE', 409);
    await expectCode(
      dialysis.scheduleSession(program.id, { scheduledFor: '2026-10-23T09:00:00.000Z' }),
      'PROGRAM_NOT_ACTIVE',
      409,
    );

    await dialysis.setProgramStatus(program.id, 'closed');
    expect((await dialysis.getProgram(program.id)).status).toBe('closed');
    await expectCode(dialysis.setProgramStatus(program.id, 'active'), 'PROGRAM_STATE_INVALID', 409);

    // listing by facility shows both programs from this run
    const list = await dialysis.listPrograms({ facilityId });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});
