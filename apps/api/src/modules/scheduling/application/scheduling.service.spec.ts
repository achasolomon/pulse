import { SchedulingService } from './scheduling.service.js';
import { transitionAppointment } from '../domain/appointment.repository.js';
import type { AppointmentRepository } from '../domain/appointment.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transitionAppointment', () => {
  it('happy path scheduled -> checked-in -> in-progress -> completed', () => {
    expect(transitionAppointment('scheduled', 'check-in')).toBe('checked-in');
    expect(transitionAppointment('checked-in', 'start')).toBe('in-progress');
    expect(transitionAppointment('in-progress', 'complete')).toBe('completed');
  });

  it('cancel/no-show/reschedule rules', () => {
    expect(transitionAppointment('scheduled', 'cancel')).toBe('cancelled');
    expect(transitionAppointment('checked-in', 'no-show')).toBe('no-show');
    expect(transitionAppointment('scheduled', 'reschedule')).toBe('scheduled');
    expect(() => transitionAppointment('completed', 'cancel')).toThrow(
      'APPOINTMENT_TRANSITION',
    );
    expect(() => transitionAppointment('scheduled', 'complete')).toThrow(
      'APPOINTMENT_TRANSITION',
    );
  });
});

describe('SchedulingService (unit, fake repo)', () => {
  function fake(): AppointmentRepository {
    const store = new Map<string, { status: 'scheduled' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled' | 'no-show' }>();
    return {
      book: async (input) => {
        const id = 'aaaaaaaa-1111-4111-8111-111111111111';
        store.set(id, { status: 'scheduled' });
        return {
          id,
          patientId: input.patientId,
          facilityId: input.facilityId,
          scheduledAt: input.scheduledAt,
          reason: input.reason,
          status: 'scheduled',
        };
      },
      findById: async (id) => {
        const s = store.get(id);
        if (!s) return undefined;
        return {
          id,
          patientId: 'p',
          facilityId: 'f',
          scheduledAt: new Date().toISOString(),
          reason: '',
          status: s.status,
        };
      },
      setStatus: async (id, status) => {
        store.set(id, { status });
        return {
          id,
          patientId: 'p',
          facilityId: 'f',
          scheduledAt: new Date().toISOString(),
          reason: '',
          status,
        };
      },
      queue: async () => [],
      appointmentsFor: async () => [],
    };
  }

  it('books then checks in', async () => {
    const svc = new SchedulingService(fake(), new OutboxService(undefined));
    const appt = await svc.book({
      patientId: 'p',
      facilityId: 'f',
      scheduledAt: new Date().toISOString(),
      reason: 'Follow-up',
    });
    const checked = await svc.checkIn(appt.id, {});
    expect(checked.status).toBe('checked-in');
  });

  it('rejects completing a scheduled appointment (422)', async () => {
    const svc = new SchedulingService(fake(), new OutboxService(undefined));
    const appt = await svc.book({
      patientId: 'p',
      facilityId: 'f',
      scheduledAt: new Date().toISOString(),
      reason: '',
    });
    const err = await svc.complete(appt.id, {}).catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });
});
