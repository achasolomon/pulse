import { TheatreService } from './theatre.service.js';
import {
  assertChecklistStage,
  nextChecklistStage,
  transitionBooking,
} from '../domain/theatre.repository.js';
import type { TheatreRepository } from '../domain/theatre.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('transitionBooking', () => {
  it('booked -> checked-in -> in-progress -> completed; cancel branches', () => {
    expect(transitionBooking('booked', 'check-in')).toBe('checked-in');
    expect(transitionBooking('checked-in', 'start')).toBe('in-progress');
    expect(transitionBooking('in-progress', 'complete')).toBe('completed');
    expect(transitionBooking('booked', 'cancel')).toBe('cancelled');
    expect(() => transitionBooking('booked', 'complete')).toThrow('THEATRE_TRANSITION');
    expect(() => transitionBooking('completed', 'cancel')).toThrow('THEATRE_TRANSITION');
  });
});

describe('checklist order (pure)', () => {
  it('advances strictly in order, rejects skips and repeats', () => {
    expect(nextChecklistStage([])).toBe('sign-in');
    expect(nextChecklistStage(['sign-in'])).toBe('time-out');
    expect(nextChecklistStage(['sign-in', 'time-out'])).toBe('sign-out');
    expect(nextChecklistStage(['sign-in', 'time-out', 'sign-out'])).toBeUndefined();
    expect(() => assertChecklistStage([], 'time-out')).toThrow('CHECKLIST_ORDER');
    expect(() => assertChecklistStage(['sign-in', 'sign-in'], 'time-out')).toThrow(
      'CHECKLIST_DUPLICATE',
    );
  });
});

describe('TheatreService (unit, fake repo)', () => {
  function fake(stages: ('sign-in' | 'time-out' | 'sign-out')[] = []) {
    const repo: TheatreRepository = {
      defineSuite: async () => ({ id: 's1' }),
      book: async () => ({ id: 'b1', status: 'booked' }),
      findBooking: async () => ({ id: 'b1', status: 'in-progress' }),
      setBookingStatus: async () => undefined,
      completedStages: async () => stages,
      completeStage: async () => undefined,
      saveRecord: async () => ({ id: 'r1' }),
    };
    return repo;
  }

  function svc(repo: TheatreRepository) {
    return new TheatreService(repo, new OutboxService(undefined));
  }

  it('refuses completion without sign-out (safety control)', async () => {
    const err = await svc(fake(['sign-in', 'time-out']))
      .complete('b1', {})
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('completes with full checklist', async () => {
    const res = await svc(fake(['sign-in', 'time-out', 'sign-out'])).complete('b1', {});
    expect(res.status).toBe('completed');
  });
});
