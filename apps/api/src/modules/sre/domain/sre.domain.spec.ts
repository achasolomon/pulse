import {
  backupStalenessMinutes,
  breaches,
  errorRate,
} from './sre.repository.js';

describe('sre domain (pure)', () => {
  it('breaches compares with > and >=', () => {
    expect(breaches(0.06, '>=', 0.05)).toBe(true);
    expect(breaches(0.05, '>=', 0.05)).toBe(true);
    expect(breaches(0.05, '>', 0.05)).toBe(false);
    expect(breaches(0.04, '>=', 0.05)).toBe(false);
  });

  it('backupStalenessMinutes measures minutes since last successful full backup', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    expect(backupStalenessMinutes({ finishedAt: tenMinAgo }, now)).toBeCloseTo(10, 5);
    expect(backupStalenessMinutes(undefined, now)).toBe(Number.POSITIVE_INFINITY);
    expect(backupStalenessMinutes({ finishedAt: 'not-a-date' }, now)).toBe(
      Number.POSITIVE_INFINITY,
    );
    // clock skew into the past clamps at zero
    const future = new Date(now.getTime() + 60_000).toISOString();
    expect(backupStalenessMinutes({ finishedAt: future }, now)).toBe(0);
  });

  it('errorRate is 0 with no traffic (never NaN)', () => {
    expect(errorRate(0, 0)).toBe(0);
    expect(errorRate(0, 10)).toBe(0);
    expect(errorRate(1, 4)).toBe(0.25);
  });
});
