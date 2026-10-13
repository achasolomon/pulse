/**
 * Dialysis / renal recurring-care domain (EPIC-25, CLIN-001 sections 22-23).
 * Each session is a distinct attributable clinical event; the protocol version
 * used for a session is preserved (sessions snapshot the protocol row).
 * Weight guardrails are assistive plausibility checks — the clinician confirms
 * (SAFE-001): implausible measurements are refused so they can be re-taken.
 */

export type AccessType = 'fistula' | 'graft' | 'catheter' | 'peritoneal';
export type ProgramStatus = 'active' | 'paused' | 'closed';
export type SessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';

export interface Protocol {
  id: string;
  code: string;
  version: number;
  name: string;
  sessionMinutes: number;
  active: boolean;
}

export interface Program {
  id: string;
  patientId: string;
  facilityId: string;
  protocolId: string;
  accessType: AccessType;
  targetWeightKg: number;
  status: ProgramStatus;
  startDate: string;
  endedAt?: string;
}

export interface DialysisSession {
  id: string;
  programId: string;
  encounterId?: string;
  protocolId: string;
  scheduledFor: string;
  status: SessionStatus;
  preWeightKg?: number;
  postWeightKg?: number;
  ultrafiltrationL?: number;
  adverseEvent?: string;
  reason?: string;
  startedAt?: string;
  completedAt?: string;
}

export const DIALYSIS_REPOSITORY = 'DIALYSIS_REPOSITORY';

export interface DialysisRepository {
  listProtocols(activeOnly?: boolean): Promise<Protocol[]>;
  getProtocol(id: string): Promise<Protocol | undefined>;
  createProgram(input: {
    patientId: string;
    facilityId: string;
    protocolId: string;
    accessType: AccessType;
    targetWeightKg: number;
    startDate?: string;
  }): Promise<Program>;
  getProgram(id: string): Promise<Program | undefined>;
  listPrograms(filter: { patientId?: string; facilityId?: string; status?: ProgramStatus }): Promise<Program[]>;
  updateProgramStatus(
    id: string,
    input: { status: ProgramStatus; endedAt?: Date },
  ): Promise<void>;
  createSession(input: {
    programId: string;
    protocolId: string;
    scheduledFor: string;
    encounterId?: string;
  }): Promise<DialysisSession>;
  getSession(id: string): Promise<DialysisSession | undefined>;
  listSessions(programId: string): Promise<DialysisSession[]>;
  updateSession(
    id: string,
    input: {
      status?: SessionStatus;
      preWeightKg?: number;
      postWeightKg?: number;
      ultrafiltrationL?: number;
      adverseEvent?: string;
      reason?: string;
      scheduledFor?: string;
      startedAt?: Date;
      completedAt?: Date;
    },
  ): Promise<void>;
}

/** Session lifecycle: deferrals reschedule back to scheduled; terminals stay put. */
export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  scheduled: ['in_progress', 'deferred', 'cancelled'],
  in_progress: ['completed', 'deferred', 'cancelled'],
  deferred: ['scheduled', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const PROGRAM_TRANSITIONS: Record<ProgramStatus, ProgramStatus[]> = {
  active: ['paused', 'closed'],
  paused: ['active', 'closed'],
  closed: [],
};

export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  return (table[from] ?? []).includes(to);
}

export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 250;

export type WeightsResult =
  | { ok: true; ultrafiltrationL: number }
  | { ok: false; code: 'WEIGHT_REQUIRED' | 'WEIGHTS_IMPLAUSIBLE'; message: string };

/**
 * Plausibility check on complete: both weights present, within range, and
 * post ≤ pre (ultrafiltration must not be negative — fluid is removed, not
 * added, during a session).
 */
export function validateWeights(pre?: number, post?: number): WeightsResult {
  if (pre === undefined || post === undefined || Number.isNaN(pre) || Number.isNaN(post)) {
    return {
      ok: false,
      code: 'WEIGHT_REQUIRED',
      message: 'Completion requires pre and post weight',
    };
  }
  if (pre < WEIGHT_MIN_KG || pre > WEIGHT_MAX_KG || post < WEIGHT_MIN_KG || post > WEIGHT_MAX_KG) {
    return {
      ok: false,
      code: 'WEIGHTS_IMPLAUSIBLE',
      message: `Weights must be within ${WEIGHT_MIN_KG}-${WEIGHT_MAX_KG} kg`,
    };
  }
  if (post > pre) {
    return {
      ok: false,
      code: 'WEIGHTS_IMPLAUSIBLE',
      message: 'Post weight cannot exceed pre weight (negative ultrafiltration)',
    };
  }
  return { ok: true, ultrafiltrationL: Math.round((pre - post) * 100) / 100 };
}
