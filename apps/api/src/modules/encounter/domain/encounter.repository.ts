/** Encounter domain (CLIN-001 ADT, DB-001 sections 14-15). */

export type EncounterType = 'outpatient' | 'inpatient' | 'emergency';
export type EncounterStatus = 'open' | 'admitted' | 'discharged' | 'cancelled';
export type EncounterAction = 'admit' | 'transfer' | 'discharge' | 'cancel';

export interface Encounter {
  id: string;
  patientId: string;
  facilityId: string;
  type: EncounterType;
  status: EncounterStatus;
  departmentId?: string;
  bed?: string;
  disposition?: string;
}

/**
 * Pure ADT state machine (F06). Returns the new status or throws
 * Error('ENCOUNTER_TRANSITION:<from>-><action>') on illegal moves.
 * - open + admit -> admitted
 * - open + cancel -> cancelled
 * - open + discharge -> discharged (outpatient/emergency only; inpatient must admit first)
 * - admitted + transfer -> admitted
 * - admitted + discharge -> discharged
 * Terminal states (discharged/cancelled) accept no further actions.
 */
export function transition(
  from: EncounterStatus,
  action: EncounterAction,
  type: EncounterType,
): EncounterStatus {
  if (from === 'discharged' || from === 'cancelled') {
    throw new Error(`ENCOUNTER_TRANSITION:${from}->${action}`);
  }
  if (from === 'open') {
    if (action === 'admit') return 'admitted';
    if (action === 'cancel') return 'cancelled';
    if (action === 'discharge') {
      if (type === 'inpatient') {
        throw new Error(`ENCOUNTER_TRANSITION:${from}->${action}`);
      }
      return 'discharged';
    }
    throw new Error(`ENCOUNTER_TRANSITION:${from}->${action}`);
  }
  // admitted
  if (action === 'transfer') return 'admitted';
  if (action === 'discharge') return 'discharged';
  throw new Error(`ENCOUNTER_TRANSITION:${from}->${action}`);
}

export const ENCOUNTER_REPOSITORY = 'ENCOUNTER_REPOSITORY';

export interface EncounterRepository {
  open(input: {
    patientId: string;
    facilityId: string;
    type: EncounterType;
  }): Promise<Encounter>;
  findById(id: string): Promise<Encounter | undefined>;
  applyTransition(input: {
    id: string;
    status: EncounterStatus;
    action: EncounterAction;
    departmentId?: string;
    bed?: string;
    disposition?: string;
  }): Promise<Encounter>;
  listHistory(encounterId: string): Promise<
    { action: EncounterAction; toDepartmentId?: string; toBed?: string }[]
  >;
  setCoverage(id: string, coverageId: string): Promise<void>;
  listActive(facilityId: string, limit: number): Promise<Encounter[]>;
}
