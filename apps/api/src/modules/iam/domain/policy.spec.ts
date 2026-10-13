import { evaluateAccess } from './policy.js';
import type { AccessRequest } from './types.js';

const base = {
  personId: 'p1',
  membership: {
    membershipId: 'm1',
    personId: 'p1',
    organizationId: 'o1',
    facilityId: '11111111-1111-1111-1111-111111111111',
    roles: ['clinician'],
    privileges: ['patient:read'],
  },
  facilityId: '11111111-1111-1111-1111-111111111111',
  action: 'read',
  resourceType: 'patient',
} satisfies Omit<AccessRequest, 'membership'> & {
  membership: AccessRequest['membership'];
};

describe('evaluateAccess (default deny)', () => {
  it('allows matching facility + privilege', () => {
    expect(evaluateAccess({ ...base })).toEqual({
      allow: true,
      reason: 'ALLOW_MEMBERSHIP_PRIVILEGE',
    });
  });

  it('denies facility mismatch even with privilege', () => {
    expect(
      evaluateAccess({
        ...base,
        facilityId: '22222222-2222-2222-2222-222222222222',
      }).allow,
    ).toBe(false);
  });

  it('denies missing privilege', () => {
    expect(
      evaluateAccess({
        ...base,
        action: 'prescribe',
        resourceType: 'medication',
      }),
    ).toEqual({ allow: false, reason: 'DENY_MISSING_PRIVILEGE' });
  });
});

describe('contextual inputs (F03.4)', () => {
  it('denies department mismatch when both sides scope a department', () => {
    expect(
      evaluateAccess({
        ...base,
        membership: { ...base.membership, departmentId: 'dep-1' },
        departmentId: 'dep-2',
      }),
    ).toEqual({ allow: false, reason: 'DENY_DEPARTMENT_MISMATCH' });
  });

  it('allows matching department scope', () => {
    expect(
      evaluateAccess({
        ...base,
        membership: { ...base.membership, departmentId: 'dep-1' },
        departmentId: 'dep-1',
      }).allow,
    ).toBe(true);
  });

  it('denies unknown purpose of use', () => {
    expect(
      evaluateAccess({
        ...base,
        purpose: 'curiosity' as never,
      }),
    ).toEqual({ allow: false, reason: 'DENY_PURPOSE_INVALID' });
  });

  it('accepts each known purpose', () => {
    for (const purpose of ['treatment', 'payment', 'operations', 'audit', 'research'] as const) {
      expect(evaluateAccess({ ...base, purpose }).allow).toBe(true);
    }
  });

  it('narrows chart access without a care relationship (§18)', () => {
    expect(
      evaluateAccess({
        ...base,
        patientId: '33333333-3333-4333-8333-333333333333',
      }),
    ).toEqual({ allow: false, reason: 'DENY_NO_CARE_RELATIONSHIP' });
  });

  it('allows chart access with a care relationship', () => {
    expect(
      evaluateAccess({
        ...base,
        patientId: '33333333-3333-4333-8333-333333333333',
        careRelationship: true,
      }).allow,
    ).toBe(true);
  });

  it('unrestricted privilege bypasses the relationship requirement', () => {
    expect(
      evaluateAccess({
        ...base,
        patientId: '33333333-3333-4333-8333-333333333333',
        membership: {
          ...base.membership,
          privileges: ['patient:read', 'care:unrestricted'],
        },
      }).allow,
    ).toBe(true);
  });

  it('non-chart resources skip relationship narrowing', () => {
    expect(
      evaluateAccess({
        ...base,
        resourceType: 'reports.census',
        action: 'read',
        patientId: '33333333-3333-4333-8333-333333333333',
        membership: {
          ...base.membership,
          privileges: ['reports.census:read'],
        },
      }).allow,
    ).toBe(true);
  });
});

describe('break-glass decision path (F03.5)', () => {
  const realReason = 'unconscious trauma patient, no identification';

  it('expands a missing clinical privilege when reasoned', () => {
    const d = evaluateAccess({
      ...base,
      membership: { ...base.membership, privileges: [] },
      breakGlass: true,
      breakGlassReason: realReason,
    });
    expect(d).toEqual({
      allow: true,
      reason: 'ALLOW_BREAK_GLASS',
      breakGlass: { reason: realReason },
    });
  });

  it('rescues chart access denied for missing relationship', () => {
    expect(
      evaluateAccess({
        ...base,
        patientId: '33333333-3333-4333-8333-333333333333',
        breakGlass: true,
        breakGlassReason: realReason,
      }).reason,
    ).toBe('ALLOW_BREAK_GLASS');
  });

  it('rejects throwaway reasons', () => {
    expect(
      evaluateAccess({
        ...base,
        membership: { ...base.membership, privileges: [] },
        breakGlass: true,
        breakGlassReason: 'testtesttest',
      }),
    ).toEqual({ allow: false, reason: 'BREAK_GLASS_REASON_REQUIRED' });
  });

  it('never expands financial or admin resources (§31)', () => {
    for (const resourceType of ['revenue.charge', 'org.facility', 'iam.membership', 'inventory.item', 'sync.feed']) {
      expect(
        evaluateAccess({
          ...base,
          resourceType,
          action: 'create',
          membership: { ...base.membership, privileges: [] },
          breakGlass: true,
          breakGlassReason: realReason,
        }),
      ).toEqual({ allow: false, reason: 'DENY_BREAK_GLASS_INELIGIBLE' });
    }
  });

  it('denies abusive repeat use', () => {
    expect(
      evaluateAccess({
        ...base,
        membership: { ...base.membership, privileges: [] },
        breakGlass: true,
        breakGlassReason: realReason,
        breakGlassRecentGrants: 3,
      }),
    ).toEqual({ allow: false, reason: 'DENY_BREAK_GLASS_ABUSE' });
  });

  it('still default-denies when break-glass is not requested', () => {
    expect(
      evaluateAccess({
        ...base,
        membership: { ...base.membership, privileges: [] },
      }).allow,
    ).toBe(false);
  });
});
