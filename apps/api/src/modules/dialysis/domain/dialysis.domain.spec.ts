import {
  PROGRAM_TRANSITIONS,
  SESSION_TRANSITIONS,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  canTransition,
  validateWeights,
} from './dialysis.repository.js';

describe('dialysis domain (pure)', () => {
  it('session transitions: scheduled->in_progress->completed; deferral loops; terminals are final', () => {
    expect(canTransition(SESSION_TRANSITIONS, 'scheduled', 'in_progress')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'in_progress', 'completed')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'scheduled', 'deferred')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'deferred', 'scheduled')).toBe(true);
    expect(canTransition(SESSION_TRANSITIONS, 'scheduled', 'cancelled')).toBe(true);
    // illegal jumps
    expect(canTransition(SESSION_TRANSITIONS, 'scheduled', 'completed')).toBe(false);
    expect(canTransition(SESSION_TRANSITIONS, 'deferred', 'completed')).toBe(false);
    expect(canTransition(SESSION_TRANSITIONS, 'completed', 'scheduled')).toBe(false);
    expect(canTransition(SESSION_TRANSITIONS, 'cancelled', 'in_progress')).toBe(false);
    expect(SESSION_TRANSITIONS.completed).toHaveLength(0);
    expect(SESSION_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it('program transitions: active<->paused, either closes, closed is final', () => {
    expect(canTransition(PROGRAM_TRANSITIONS, 'active', 'paused')).toBe(true);
    expect(canTransition(PROGRAM_TRANSITIONS, 'paused', 'active')).toBe(true);
    expect(canTransition(PROGRAM_TRANSITIONS, 'active', 'closed')).toBe(true);
    expect(canTransition(PROGRAM_TRANSITIONS, 'paused', 'closed')).toBe(true);
    expect(canTransition(PROGRAM_TRANSITIONS, 'closed', 'active')).toBe(false);
    expect(PROGRAM_TRANSITIONS.closed).toHaveLength(0);
  });

  it('validateWeights: required, plausible range, non-negative ultrafiltration', () => {
    expect(validateWeights(undefined, 70)).toMatchObject({ ok: false, code: 'WEIGHT_REQUIRED' });
    expect(validateWeights(70, undefined)).toMatchObject({ ok: false, code: 'WEIGHT_REQUIRED' });
    expect(validateWeights(WEIGHT_MIN_KG - 1, 70)).toMatchObject({
      ok: false,
      code: 'WEIGHTS_IMPLAUSIBLE',
    });
    expect(validateWeights(70, WEIGHT_MAX_KG + 1)).toMatchObject({
      ok: false,
      code: 'WEIGHTS_IMPLAUSIBLE',
    });
    expect(validateWeights(70, 71.5)).toMatchObject({
      ok: false,
      code: 'WEIGHTS_IMPLAUSIBLE',
    });
    const ok = validateWeights(72.4, 70.1);
    expect(ok).toEqual({ ok: true, ultrafiltrationL: 2.3 });
    expect(validateWeights(70, 70)).toEqual({ ok: true, ultrafiltrationL: 0 });
  });
});
