import {
  SHIFT_TRANSITIONS,
  canTransition,
  hoursBetween,
  isOnCallNow,
  overlaps,
} from './roster.repository.js';

describe('roster pure helpers', () => {
  it('detects interval overlap (half-open windows)', () => {
    const a0 = new Date('2026-06-01T08:00:00Z');
    const a1 = new Date('2026-06-01T16:00:00Z');
    expect(overlaps(a0, a1, new Date('2026-06-01T12:00:00Z'), new Date('2026-06-01T20:00:00Z'))).toBe(true);
    expect(overlaps(a0, a1, new Date('2026-06-01T16:00:00Z'), new Date('2026-06-01T20:00:00Z'))).toBe(false);
    expect(overlaps(a0, a1, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T08:00:00Z'))).toBe(false);
    expect(overlaps(a0, a1, new Date('2026-06-01T09:00:00Z'), new Date('2026-06-01T10:00:00Z'))).toBe(true);
  });

  it('measures hours between instants', () => {
    expect(hoursBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-01T16:00:00Z'))).toBe(8);
    expect(hoursBetween(new Date('2026-06-01T20:00:00Z'), new Date('2026-06-02T08:00:00Z'))).toBe(12);
  });

  it('on-call now: scheduled windows contain the instant; terminals do not', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const base = { startsAt: '2026-06-10T08:00:00Z', endsAt: '2026-06-10T20:00:00Z' };
    expect(isOnCallNow({ ...base, status: 'scheduled' }, now)).toBe(true);
    expect(isOnCallNow({ ...base, status: 'completed' }, now)).toBe(false);
    expect(isOnCallNow({ ...base, status: 'cancelled' }, now)).toBe(false);
    expect(
      isOnCallNow({ ...base, status: 'scheduled' }, new Date('2026-06-10T20:00:00Z')),
    ).toBe(false);
    expect(
      isOnCallNow({ ...base, status: 'scheduled' }, new Date('2026-06-10T08:00:00Z')),
    ).toBe(true);
  });

  it('shift lifecycle: terminals stay put', () => {
    expect(canTransition(SHIFT_TRANSITIONS, 'scheduled', 'completed')).toBe(true);
    expect(canTransition(SHIFT_TRANSITIONS, 'scheduled', 'cancelled')).toBe(true);
    expect(canTransition(SHIFT_TRANSITIONS, 'completed', 'cancelled')).toBe(false);
    expect(canTransition(SHIFT_TRANSITIONS, 'cancelled', 'completed')).toBe(false);
    expect(canTransition(SHIFT_TRANSITIONS, 'completed', 'completed')).toBe(false);
  });
});
