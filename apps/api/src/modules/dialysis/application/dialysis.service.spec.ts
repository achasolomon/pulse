import { DialysisService } from './dialysis.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import {
  type DialysisRepository,
  type DialysisSession,
  type Program,
  type Protocol,
} from '../domain/dialysis.repository.js';

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

const PROTOCOL: Protocol = {
  id: '00000000-0000-4000-8000-00000000e001',
  code: 'HD-STD',
  version: 1,
  name: 'Standard haemodialysis',
  sessionMinutes: 240,
  active: true,
};

const FACILITY = '00000000-0000-4000-8000-000000000002';
const PATIENT = '00000000-0000-4000-8000-000000000003';

function store(opts: { patient?: { id: string; facilityId: string } | undefined } = {}) {
  const programs = new Map<string, Program>();
  const sessions = new Map<string, DialysisSession>();
  let pSeq = 0;
  let sSeq = 0;
  const repo: DialysisRepository = {
    listProtocols: async () => [PROTOCOL],
    getProtocol: async (id) => (id === PROTOCOL.id ? PROTOCOL : undefined),
    createProgram: async (input) => {
      pSeq += 1;
      const p: Program = {
        id: `00000000-0000-4000-8000-${String(pSeq).padStart(12, '0')}`,
        patientId: input.patientId,
        facilityId: input.facilityId,
        protocolId: input.protocolId,
        accessType: input.accessType,
        targetWeightKg: input.targetWeightKg,
        status: 'active',
        startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
      };
      programs.set(p.id, p);
      return p;
    },
    getProgram: async (id) => programs.get(id),
    listPrograms: async (filter) =>
      [...programs.values()].filter(
        (p) =>
          (!filter.patientId || p.patientId === filter.patientId) &&
          (!filter.facilityId || p.facilityId === filter.facilityId) &&
          (!filter.status || p.status === filter.status),
      ),
    updateProgramStatus: async (id, input) => {
      const p = programs.get(id);
      if (p) {
        p.status = input.status;
        if (input.endedAt) p.endedAt = input.endedAt.toISOString();
      }
    },
    createSession: async (input) => {
      sSeq += 1;
      const s: DialysisSession = {
        id: `00000000-0000-4000-8000-${String(1000 + sSeq).padStart(12, '0')}`,
        programId: input.programId,
        protocolId: input.protocolId,
        scheduledFor: input.scheduledFor,
        status: 'scheduled',
        ...(input.encounterId ? { encounterId: input.encounterId } : {}),
      };
      sessions.set(s.id, s);
      return s;
    },
    getSession: async (id) => sessions.get(id),
    listSessions: async (programId) =>
      [...sessions.values()].filter((s) => s.programId === programId),
    updateSession: async (id, input) => {
      const s = sessions.get(id);
      if (!s) return;
      if (input.status) s.status = input.status;
      if (input.preWeightKg !== undefined) s.preWeightKg = input.preWeightKg;
      if (input.postWeightKg !== undefined) s.postWeightKg = input.postWeightKg;
      if (input.ultrafiltrationL !== undefined) s.ultrafiltrationL = input.ultrafiltrationL;
      if (input.adverseEvent !== undefined) s.adverseEvent = input.adverseEvent;
      if (input.reason !== undefined) s.reason = input.reason;
      if (input.scheduledFor !== undefined) s.scheduledFor = input.scheduledFor;
      if (input.startedAt !== undefined) s.startedAt = input.startedAt.toISOString();
      if (input.completedAt !== undefined) s.completedAt = input.completedAt.toISOString();
    },
  };
  const patient =
    'patient' in opts ? opts.patient : { id: PATIENT, facilityId: FACILITY };
  const patients = {
    findById: async (id: string) =>
      patient && id === patient.id ? patient : undefined,
  } as unknown as PatientRepository;
  return { repo, patients, programs, sessions };
}

const svc = (s: ReturnType<typeof store>) =>
  new DialysisService(s.repo, s.patients, new OutboxService(undefined));

const programIn = (over: Record<string, unknown> = {}) => ({
  patientId: PATIENT,
  facilityId: FACILITY,
  protocolId: PROTOCOL.id,
  accessType: 'fistula' as const,
  targetWeightKg: 68,
  ...over,
});

describe('DialysisService (unit, fakes)', () => {
  it('createProgram validates patient, facility, protocol, target weight', async () => {
    const s = store();
    const p = await svc(s).createProgram(programIn());
    expect(p.status).toBe('active');
    await expectCode(svc(s).createProgram(programIn({ patientId: 'nope' })), 'PATIENT_NOT_FOUND', 404);
    await expectCode(
      svc(s).createProgram(programIn({ facilityId: '00000000-0000-4000-8000-00000000ffff' })),
      'PROGRAM_FACILITY_MISMATCH',
      422,
    );
    await expectCode(
      svc(s).createProgram(programIn({ protocolId: '00000000-0000-4000-8000-00000000e002' })),
      'PROTOCOL_NOT_FOUND',
      404,
    );
    await expectCode(
      svc(s).createProgram(programIn({ targetWeightKg: 15 })),
      'TARGET_WEIGHT_IMPLAUSIBLE',
      422,
    );
  });

  it('program lifecycle: pause blocks scheduling/start; resume re-enables; closed is terminal', async () => {
    const s = store();
    const dialysis = svc(s);
    const program = await dialysis.createProgram(programIn());
    const at = () => ({ scheduledFor: new Date().toISOString() });

    const session = await dialysis.scheduleSession(program.id, at());

    await dialysis.setProgramStatus(program.id, 'paused');
    await expectCode(dialysis.scheduleSession(program.id, at()), 'PROGRAM_NOT_ACTIVE', 409);
    await expectCode(dialysis.transitionSession(session.id, 'in_progress'), 'PROGRAM_NOT_ACTIVE', 409);

    await dialysis.setProgramStatus(program.id, 'active');
    const started = await dialysis.transitionSession(session.id, 'in_progress');
    expect(started.status).toBe('in_progress');

    await dialysis.setProgramStatus(program.id, 'closed');
    await expectCode(dialysis.setProgramStatus(program.id, 'active'), 'PROGRAM_STATE_INVALID', 409);
    await expectCode(dialysis.scheduleSession(program.id, at()), 'PROGRAM_NOT_ACTIVE', 409);
  });

  it('session flow: illegal jumps 409, defer needs reason, weights guard, reschedule resumes', async () => {
    const s = store();
    const dialysis = svc(s);
    const program = await dialysis.createProgram(programIn());
    const session = await dialysis.scheduleSession(program.id, {
      scheduledFor: new Date().toISOString(),
    });

    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70, postWeightKg: 68 }),
      'SESSION_STATE_INVALID',
      409,
    );
    await expectCode(dialysis.transitionSession(session.id, 'deferred'), 'DEFERRAL_REASON_REQUIRED', 400);

    const deferred = await dialysis.transitionSession(session.id, 'deferred', {
      reason: 'Facility flooded, rescheduled',
    });
    expect(deferred.status).toBe('deferred');
    expect(deferred.reason).toBe('Facility flooded, rescheduled');
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70, postWeightKg: 68 }),
      'SESSION_STATE_INVALID',
      409,
    );

    await dialysis.transitionSession(session.id, 'scheduled', {
      scheduledFor: '2026-10-20T09:00:00.000Z',
    });
    await dialysis.transitionSession(session.id, 'in_progress');
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70 }),
      'WEIGHT_REQUIRED',
      422,
    );
    await expectCode(
      dialysis.transitionSession(session.id, 'completed', { preWeightKg: 70, postWeightKg: 72 }),
      'WEIGHTS_IMPLAUSIBLE',
      422,
    );
    const done = await dialysis.transitionSession(session.id, 'completed', {
      preWeightKg: 71.2,
      postWeightKg: 68.9,
      adverseEvent: 'Mild cramp, resolved',
    });
    expect(done.status).toBe('completed');
    expect(done.ultrafiltrationL).toBe(2.3);
    expect(done.adverseEvent).toBe('Mild cramp, resolved');
    await expectCode(dialysis.transitionSession(session.id, 'scheduled'), 'SESSION_STATE_INVALID', 409);
  });
});
