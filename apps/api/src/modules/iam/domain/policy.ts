import {
  isAbusiveRepeatUse,
  isBreakGlassEligible,
  isKnownPurpose,
  isRealBreakGlassReason,
} from './break-glass.js';
import type {
  AccessDecision,
  AccessDecisionReason,
  AccessRequest,
} from './types.js';

/**
 * Pure default-deny policy engine (IAM-001 §2/§17/§18/§31).
 * Order: facility → department → purpose → privilege → care relationship.
 * Care relationship narrows but never replaces explicit privilege.
 * Break-glass is a recorded, scoped, time-limited last resort — never an
 * administrator bypass; grant persistence happens in the guard/service.
 */
export function evaluateAccess(req: AccessRequest): AccessDecision {
  if (req.membership.facilityId !== req.facilityId) {
    return deny('DENY_FACILITY_MISMATCH');
  }
  if (
    req.membership.departmentId &&
    req.departmentId &&
    req.membership.departmentId !== req.departmentId
  ) {
    return deny('DENY_DEPARTMENT_MISMATCH');
  }
  if (req.purpose !== undefined && !isKnownPurpose(req.purpose)) {
    return deny('DENY_PURPOSE_INVALID');
  }

  const needed = `${req.resourceType}:${req.action}`;
  if (!req.membership.privileges.includes(needed)) {
    return breakGlassOr(req, 'DENY_MISSING_PRIVILEGE');
  }

  // §18: opening a chart requires a care relationship (or an explicit
  // unrestricted privilege). Engages only with an explicit patient scope.
  const chartScoped =
    req.patientId !== undefined && CHART_RESOURCES.has(req.resourceType);
  if (
    chartScoped &&
    !req.careRelationship &&
    !req.membership.privileges.includes('care:unrestricted')
  ) {
    return breakGlassOr(req, 'DENY_NO_CARE_RELATIONSHIP');
  }

  return { allow: true, reason: 'ALLOW_MEMBERSHIP_PRIVILEGE' };
}

/** Patient-data resources whose chart access needs a care relationship (§18). */
const CHART_RESOURCES = new Set([
  'patient',
  'encounter',
  'vitals',
  'clinical.note',
  'clinical.handover',
  'lab.order',
  'lab.result',
  'imaging.order',
  'imaging.report',
  'medication.prescription',
  'medication.dispense',
  'medication.admin',
  'scheduling.appointment',
  'referral',
  'consent',
  'documents.document',
  'bloodbank.unit',
  'theatre.booking',
  'emergency.triage',
  'timeline',
]);

function deny(reason: AccessDecisionReason): AccessDecision {
  return { allow: false, reason };
}

function breakGlassOr(req: AccessRequest, fallback: AccessDecisionReason): AccessDecision {
  if (!req.breakGlass) return deny(fallback);
  if (!req.breakGlassReason || !isRealBreakGlassReason(req.breakGlassReason)) {
    return deny('BREAK_GLASS_REASON_REQUIRED');
  }
  if (!isBreakGlassEligible(req.resourceType, req.action)) {
    return deny('DENY_BREAK_GLASS_INELIGIBLE');
  }
  if (
    req.breakGlassRecentGrants !== undefined &&
    isAbusiveRepeatUse(req.breakGlassRecentGrants)
  ) {
    return deny('DENY_BREAK_GLASS_ABUSE');
  }
  return {
    allow: true,
    reason: 'ALLOW_BREAK_GLASS',
    breakGlass: { reason: req.breakGlassReason },
  };
}
