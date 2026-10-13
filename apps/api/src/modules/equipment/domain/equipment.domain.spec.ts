import { ASSET_TRANSITIONS, canTransition, isOverdue } from './equipment.repository.js';

describe('asset lifecycle (pure)', () => {
  it('allows reversible downtime and terminal retirement', () => {
    expect(canTransition(ASSET_TRANSITIONS, 'in_service', 'out_of_service')).toBe(true);
    expect(canTransition(ASSET_TRANSITIONS, 'out_of_service', 'in_service')).toBe(true);
    expect(canTransition(ASSET_TRANSITIONS, 'in_service', 'retired')).toBe(true);
    expect(canTransition(ASSET_TRANSITIONS, 'out_of_service', 'retired')).toBe(true);
    expect(canTransition(ASSET_TRANSITIONS, 'retired', 'in_service')).toBe(false);
    expect(canTransition(ASSET_TRANSITIONS, 'retired', 'retired')).toBe(false);
    expect(canTransition(ASSET_TRANSITIONS, 'in_service', 'in_service')).toBe(false);
  });

  it('derives overdue from the clock: scheduled and past due only', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    expect(isOverdue({ status: 'scheduled', dueAt: '2026-06-14T09:00:00.000Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'scheduled', dueAt: '2026-06-16T09:00:00.000Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'completed', dueAt: '2026-06-01T09:00:00.000Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'cancelled', dueAt: '2026-06-01T09:00:00.000Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'scheduled', dueAt: '2026-06-15T11:59:59.000Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'scheduled', dueAt: '2026-06-15T12:00:00.000Z' }, now)).toBe(false);
  });
});
