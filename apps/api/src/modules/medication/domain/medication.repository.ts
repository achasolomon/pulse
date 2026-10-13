/** Medication domain (MED-001, EPIC-12, DB-001 sections 26-30). */

export type MedRequestStatus =
  | 'prescribed'
  | 'verified'
  | 'dispensed'
  | 'completed'
  | 'held'
  | 'cancelled';

export type AdminOutcome = 'given' | 'not-given' | 'held';

/** Pure prescription machine. Throws Error('MED_TRANSITION:...') on illegal moves. */
export function transitionMedication(
  from: MedRequestStatus,
  action: 'verify' | 'dispense' | 'complete' | 'hold' | 'resume' | 'cancel',
): MedRequestStatus {
  if (action === 'cancel') {
    if (from === 'completed' || from === 'cancelled') {
      throw new Error(`MED_TRANSITION:${from}->${action}`);
    }
    return 'cancelled';
  }
  const next: Record<string, MedRequestStatus> = {
    'prescribed:verify': 'verified',
    'verified:dispense': 'dispensed',
    'dispensed:complete': 'completed',
    'dispensed:hold': 'held',
    'verified:hold': 'held',
    'held:resume': 'dispensed',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`MED_TRANSITION:${from}->${action}`);
  return to;
}

export const MEDICATION_REPOSITORY = 'MEDICATION_REPOSITORY';

export interface MedicationRepository {
  defineMedication(input: {
    code: string;
    name: string;
    doseForm: string;
    strength: string;
    route: string;
  }): Promise<{ id: string; version: number }>;
  findMedication(code: string): Promise<{ id: string; version: number } | undefined>;
  prescribe(input: {
    patientId: string;
    encounterId: string;
    medicationId: string;
    dose: string;
    doseUnit: string;
    route: string;
    frequency: string;
  }): Promise<{ id: string; status: MedRequestStatus }>;
  findRequest(id: string): Promise<{ id: string; status: MedRequestStatus } | undefined>;
  setStatus(
    id: string,
    status: MedRequestStatus,
    extra?: { holdReason?: string; cancelReason?: string },
  ): Promise<void>;
  dispense(requestId: string, input: { quantity: string; batch: string }): Promise<{ id: string }>;
  administer(requestId: string, input: {
    doseGiven: string;
    outcome: AdminOutcome;
    reason: string;
  }): Promise<{ id: string }>;
  administrations(requestId: string): Promise<{ outcome: AdminOutcome }[]>;
  prescriptionsFor(patientId: string, limit: number): Promise<{ id: string; status: string }[]>;
  /** Billing context for a dispensed request (patient/encounter/medication code). */
  contextForRequest(requestId: string): Promise<
    { patientId: string; encounterId: string; medicationCode: string } | undefined
  >;
}
