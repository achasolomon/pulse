import {
  BREAK_GLASS_ABUSE_THRESHOLD,
  isAbusiveRepeatUse,
  isBreakGlassEligible,
  isKnownPurpose,
  isRealBreakGlassReason,
} from './break-glass.js';

describe('break-glass reason quality (§31)', () => {
  it('accepts a specific emergency justification', () => {
    expect(
      isRealBreakGlassReason('cardiac arrest in ED, on-call unreachable'),
    ).toBe(true);
    expect(isRealBreakGlassReason('unconscious trauma patient, no ID')).toBe(true);
  });

  it('rejects short, throwaway, and padded-garbage reasons', () => {
    expect(isRealBreakGlassReason('urgent')).toBe(false);
    expect(isRealBreakGlassReason('testtesttest')).toBe(false);
    expect(isRealBreakGlassReason('xxxxxxxxxx')).toBe(false);
    expect(isRealBreakGlassReason('   aaaaaaaaaa   ')).toBe(false);
    expect(isRealBreakGlassReason('n/a')).toBe(false);
  });
});

describe('break-glass eligibility (§31: not an admin bypass)', () => {
  it('covers clinical patient-data resources', () => {
    expect(isBreakGlassEligible('patient', 'read')).toBe(true);
    expect(isBreakGlassEligible('encounter', 'read')).toBe(true);
    expect(isBreakGlassEligible('lab.result', 'read')).toBe(true);
  });

  it('excludes financial, admin, config, and destructive actions', () => {
    expect(isBreakGlassEligible('revenue.charge', 'create')).toBe(false);
    expect(isBreakGlassEligible('org.facility', 'manage')).toBe(false);
    expect(isBreakGlassEligible('iam.membership', 'create')).toBe(false);
    expect(isBreakGlassEligible('inventory.item', 'adjust')).toBe(false);
    expect(isBreakGlassEligible('patient', 'delete')).toBe(false);
    expect(isBreakGlassEligible('patient', 'manage')).toBe(false);
  });
});

describe('repeat-use monitor', () => {
  it('flags at the threshold', () => {
    expect(isAbusiveRepeatUse(BREAK_GLASS_ABUSE_THRESHOLD)).toBe(true);
    expect(isAbusiveRepeatUse(BREAK_GLASS_ABUSE_THRESHOLD - 1)).toBe(false);
  });
});

describe('purpose of use', () => {
  it('knows the §20 purposes only', () => {
    expect(isKnownPurpose('treatment')).toBe(true);
    expect(isKnownPurpose('research')).toBe(true);
    expect(isKnownPurpose('curiosity')).toBe(false);
  });
});
