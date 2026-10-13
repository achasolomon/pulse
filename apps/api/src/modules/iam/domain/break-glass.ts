import type { PurposeOfUse } from './types.js';

/**
 * Break-glass domain rules (IAM-001 §31). Pure: eligibility, reason quality,
 * abuse threshold. Persistence + events live in BreakGlassService.
 */

/** Short, time-limited emergency window (§31 "Duration: short/time-limited"). */
export const BREAK_GLASS_TTL_MS = 30 * 60 * 1000;

/** Repeat-use monitor: more than this many grants in the window flags abuse. */
export const BREAK_GLASS_ABUSE_THRESHOLD = 3;

export const BREAK_GLASS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Clinical patient-data resources only — never financial/admin/config (§31). */
const ELIGIBLE_RESOURCES = new Set([
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

const INELIGIBLE_ACTIONS = new Set(['delete', 'purge', 'manage', 'merge']);

/** §31: break-glass is not an administrator bypass. */
export function isBreakGlassEligible(resourceType: string, action: string): boolean {
  return ELIGIBLE_RESOURCES.has(resourceType) && !INELIGIBLE_ACTIONS.has(action);
}

/** Throwaway justifications rejected even at acceptable length. */
const THROWAWAY_REASONS = new Set([
  'test',
  'testing',
  'testtest',
  'testtesttest',
  'asdf',
  'asdfasdf',
  'qwerty',
  'qwertyuiop',
  'foobar',
  'foo',
  'bar',
  'baz',
  'n/a',
  'na',
  'none',
  'null',
  'dummy',
  'sample',
  'example',
  'reason',
  'justification',
  'breakglass',
  'break-glass',
  'urgent',
  'emergency',
  'asap',
  'help',
  'please',
  'now',
  'abc',
  'aaaaaa',
  'xxxxxxxxxx',
  '123456',
  '12345678',
  'password',
]);

/** §31: reason is mandatory and must describe the emergency. */
export function isRealBreakGlassReason(reason: string): boolean {
  const r = reason.trim().toLowerCase();
  if (r.length < 10) return false;
  if (THROWAWAY_REASONS.has(r)) return false;
  const stripped = r.replace(/[^a-z0-9]/g, '');
  if (stripped.length < 8) return false;
  if (/^(.)\1*$/.test(stripped)) return false;
  return true;
}

/** §31 repeat-use monitor. */
export function isAbusiveRepeatUse(recentGrants: number): boolean {
  return recentGrants >= BREAK_GLASS_ABUSE_THRESHOLD;
}

/** Purpose of use is contextual input (§17/§20); unknown purposes deny. */
export function isKnownPurpose(purpose: string): purpose is PurposeOfUse {
  return (
    purpose === 'treatment' ||
    purpose === 'payment' ||
    purpose === 'operations' ||
    purpose === 'audit' ||
    purpose === 'research'
  );
}
