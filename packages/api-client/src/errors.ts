/**
 * Typed error surface for the Pulse API error model (PULSE-API-001 §A8:
 * ProblemDetails `{ title, status, detail?, instance?, code?, correlationId?, errors? }`).
 * FE-001 §25: map machine error codes to user-safe messages, preserve the
 * correlation id for support, keep field errors inline, flag conflict for
 * reload/reconcile, and never leak restricted detail on 403.
 */
export interface ProblemDetails {
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}

export type ApiErrorKind =
  | 'unauthenticated'
  | 'mfa-required'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'not-found'
  | 'client'
  | 'server'
  | 'network'
  | 'aborted';

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly code: string | undefined;
  readonly correlationId: string | undefined;
  readonly fieldErrors: Record<string, string[]> | undefined;
  readonly instance: string | undefined;

  constructor(init: {
    status: number;
    kind: ApiErrorKind;
    code?: string;
    message: string;
    correlationId?: string;
    fieldErrors?: Record<string, string[]>;
    instance?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.kind = init.kind;
    this.code = init.code;
    this.correlationId = init.correlationId;
    this.fieldErrors = init.fieldErrors;
    this.instance = init.instance;
  }
}

const USER_MESSAGE_BY_CODE: Record<string, string> = {
  IMAGING_CATALOGUE_CHANGED:'The selected procedure or version is no longer available at this facility. Your information is kept; return to the catalogue and review a current procedure.',
  IMAGING_LATERALITY_REQUIRED:'Select the side required by this procedure before placing the request.',
  IMAGING_ORDER_PENDING:'A matching imaging request for this procedure and side is already pending. Review it before ordering again.',
  IMAGING_ENCOUNTER_NOT_ASSIGNED:'Start your assigned consultation before requesting imaging. Your entered information is kept.',
  IMAGING_CANCELLATION_UNAVAILABLE:'Radiology processing has started or this request has changed. Your reason is kept; review its status and contact radiology.',
  STAFF_IMAGING_WORKFLOW_REQUIRED:'Use the patient chart imaging workflow. Legacy imaging routes are unavailable to staff sessions.',
  LAB_CRITICAL_BACKUP_EXISTS:'This covering clinician already has a routing record. Review its status before choosing another recipient.',
  LAB_CRITICAL_CHANGED:'This critical follow-up has changed. Your information is kept; reopen it to review the latest evidence.',
  LAB_CRITICAL_CONTACT_REQUIRED:'Laboratory staff must record completed communication and read-back before acknowledgement.',
  LAB_CRITICAL_REPORT_PINNED:'Critical communication has started. Result changes require a governed correction.',
  LAB_REVIEW_REQUIRED:'Reconcile result provenance before final verification.',
  LAB_INDEPENDENT_REVIEW_REQUIRED:'A different authorised laboratory verifier must review these results.',
  LAB_CRITICAL_RELEASE_HELD:'Critical release is held until the finding is confirmed, communicated with read-back, and explicitly acknowledged by the responsible clinician.',
  LAB_WORKFLOW_CHANGED:'This request has changed or is no longer eligible for this step. Your information is kept; close and reopen it to review the latest order.',
  LAB_SPECIMEN_IDENTITY_CONFLICT:'This specimen label or accession identifier is already recorded at this facility. Your information is kept; verify the physical specimen and existing record.',
  LAB_SPECIMEN_TIME_INVALID:'The recorded time must follow the preceding order/collection event and must not be in the future.',
  LAB_SPECIMEN_IDENTIFIER_INVALID:'Use a 3–100 character identifier with letters, numbers, dot, hyphen, slash, colon or underscore.',
  LAB_CATALOGUE_CHANGED:'The selected test or version is no longer available. Your indication is kept; return to the catalogue and select an available test.',
  LAB_ORDER_PENDING:'This encounter already has a pending order for this test. Review the investigation history before ordering again.',
  LAB_ENCOUNTER_NOT_ASSIGNED:'Start your assigned consultation before ordering laboratory tests. Your entered information is kept.',
  LAB_CANCELLATION_UNAVAILABLE:'This order has changed or laboratory processing has started. Your reason is kept; review its status and contact the laboratory.',
  STAFF_LAB_WORKFLOW_REQUIRED:'Use the patient chart laboratory workflow for this action.',
  ALLERGY_NEGATIVE_CONFLICT: 'This declaration conflicts with active allergy records. Review those entries before recording a negative allergy status.',
  ALLERGY_REVISION_CONFLICT: 'The allergy record has changed. Your text is kept; close and reopen the drawer to review the latest list.',
  ALLERGY_DUPLICATE: 'This substance already has an active allergy record. Review it before adding another.',
  ALLERGY_ENCOUNTER_NOT_ASSIGNED: 'Your active care assignment is no longer available. Your text is kept; check your assignment in Staff worklists.',
  PROBLEM_ALREADY_ACTIVE: 'An active entry with this description already exists. Review the problem list before adding another.',
  PROBLEM_VERSION_CONFLICT: 'This entry has changed. Your reason is kept; close and reopen it to review the latest record.',
  PROBLEM_ENCOUNTER_NOT_ASSIGNED: 'Start your assigned consultation before changing the problem list. Your entered text is kept.',
  NOTE_VERSION_CONFLICT: 'This note has changed. Your text is still here. Close and reopen it to review the latest version.',
  NOTE_ENCOUNTER_NOT_ASSIGNED: 'This encounter is no longer available for your documentation. Your text is kept; confirm your assignment in Staff worklists.',
  NOTE_SIGNED: 'This note has been signed and cannot be edited. Add an addendum instead.',
  NOTE_NOT_SIGNED: 'Edit the draft before signing. Addenda apply to signed notes only.',
  NOTE_CONTENT_REQUIRED: 'Record a reason for the note and clinical content before signing.',
  STAFF_AUTH_FAILED: 'Incorrect username or password.',
  STAFF_REAUTH_FAILED: 'Check your current password and authenticator code.',
  RECOVERY_LINK_INVALID: 'This link is invalid, expired, or already used. Request a new link.',
  RECOVERY_UNAVAILABLE: 'Password recovery is temporarily unavailable. Please try again later.',
  STAFF_MFA_REQUIRED: 'Enter your authenticator code to continue.',
  STAFF_SESSION_INVALID: 'Your session is no longer valid. Please sign in again.',
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  DEMO_DISABLED: 'This environment requires a staff sign-in.',
  TENANT_CONTEXT_REQUIRED: 'Organization context is missing. Contact your administrator.',
  FACILITY_CONTEXT_REQUIRED: 'Facility context is missing. Select a facility and retry.',
  BREAK_GLASS_REASON_REQUIRED: 'Emergency access needs a written justification.',
  SECRET_WEAK: 'Password does not meet the minimum length requirement.',
  IDENTITY_REQUIRED: 'The account could not be linked to a person or service account.',
};

function userMessageFor(status: number, code: string | undefined): string {
  if (code && USER_MESSAGE_BY_CODE[code]) return USER_MESSAGE_BY_CODE[code];
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403)
    return 'This action is unavailable for your account. Contact your administrator for access.';
  if (status === 404) return 'The requested item could not be found.';
  if (status === 409)
    return 'This record changed while you were working. Reload to see the latest version.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'The service is temporarily unavailable. Try again shortly.';
  return 'The request could not be completed.';
}

function kindFor(status: number, code: string | undefined): ApiErrorKind {
  if (code === 'STAFF_MFA_REQUIRED') return 'mfa-required';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'client';
}

export function problemToApiError(
  problem: ProblemDetails,
  fallbackCorrelationId?: string,
): ApiError {
  const status = problem.status ?? 500;
  const correlationId = problem.correlationId ?? fallbackCorrelationId;
  const code = problem.code;
  return new ApiError({
    status,
    kind: kindFor(status, code),
    ...(code ? { code } : {}),
    message: userMessageFor(status, code),
    ...(correlationId ? { correlationId } : {}),
    ...(problem.errors ? { fieldErrors: problem.errors } : {}),
    ...(problem.instance ? { instance: problem.instance } : {}),
  });
}

export function networkError(correlationId?: string, cause?: unknown): ApiError {
  return new ApiError({
    status: 0,
    kind: 'network',
    message:
      'Could not reach the Pulse service. Check your connection and try again.',
    ...(correlationId ? { correlationId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function abortedError(): ApiError {
  return new ApiError({
    status: 0,
    kind: 'aborted',
    message: 'Request cancelled.',
  });
}
