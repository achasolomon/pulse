/**
 * IAM domain primitives (IAM-001 sections 3-5). Sprint 02 skeleton:
 * role !== clinical privilege; memberships scoped; default deny.
 */

export type IdentityClass =
  | 'workforce'
  | 'patient'
  | 'service-account'
  | 'proxy';

export interface Membership {
  membershipId: string;
  personId: string;
  organizationId: string;
  facilityId: string;
  roles: string[];
  privileges: string[];
  departmentId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export type PurposeOfUse = 'treatment' | 'payment' | 'operations' | 'audit' | 'research';

export const PURPOSES: readonly PurposeOfUse[] = [
  'treatment',
  'payment',
  'operations',
  'audit',
  'research',
];

export interface AccessRequest {
  personId: string;
  membership: Membership;
  /** facility the caller claims to act within */
  facilityId: string;
  /** patient care relationship asserted, if any */
  careRelationship?: boolean;
  action: string;
  resourceType: string;
  /** explicit patient scope (x-patient-id) — engages chart narrowing (§18) */
  patientId?: string;
  /** department scope claimed with the request (x-department-id) */
  departmentId?: string;
  /** purpose of use (x-purpose) */
  purpose?: PurposeOfUse;
  breakGlass?: boolean;
  breakGlassReason?: string;
  /** grants opened by this person in the abuse window (§31 repeat-use monitor) */
  breakGlassRecentGrants?: number;
}

export type AccessDecisionReason =
  | 'ALLOW_MEMBERSHIP_PRIVILEGE'
  | 'ALLOW_BREAK_GLASS'
  | 'DENY_NO_MEMBERSHIP_SCOPE'
  | 'DENY_FACILITY_MISMATCH'
  | 'DENY_DEPARTMENT_MISMATCH'
  | 'DENY_PURPOSE_INVALID'
  | 'DENY_MISSING_PRIVILEGE'
  | 'DENY_NO_CARE_RELATIONSHIP'
  | 'DENY_BREAK_GLASS_INELIGIBLE'
  | 'DENY_BREAK_GLASS_ABUSE'
  | 'BREAK_GLASS_REASON_REQUIRED'
  | 'DENY_DEFAULT';

export interface AccessDecision {
  allow: boolean;
  reason: AccessDecisionReason;
  /** set on ALLOW_BREAK_GLASS so the guard can persist the grant (§31) */
  breakGlass?: { reason: string };
}
