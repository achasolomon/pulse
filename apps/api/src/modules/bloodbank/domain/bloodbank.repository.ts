/** Blood bank domain (R6, LAB-001 section 3 deferral). Compatibility is safety-critical. */

export type ABO = 'O' | 'A' | 'B' | 'AB';
export type Rh = '+' | '-';
export type UnitStatus =
  | 'collected'
  | 'tested'
  | 'available'
  | 'reserved'
  | 'issued'
  | 'transfused'
  | 'expired'
  | 'discarded';

/**
 * Pure ABO/Rh compatibility (donor -> recipient). O-negative is the universal
 * donor; AB-positive the universal recipient; Rh-negative never receives Rh-positive.
 */
export function isCompatible(
  donor: { abo: ABO; rh: Rh },
  recipient: { abo: ABO; rh: Rh },
): boolean {
  const aboOk =
    donor.abo === 'O' ||
    donor.abo === recipient.abo ||
    recipient.abo === 'AB';
  const rhOk = donor.rh === '-' || recipient.rh === '+';
  return aboOk && rhOk;
}

/** Pure unit lifecycle. Throws Error('BANK_TRANSITION:...') on illegal moves. */
export function transitionUnit(
  from: UnitStatus,
  action: 'test' | 'release' | 'reserve' | 'issue' | 'transfuse' | 'expire' | 'discard',
): UnitStatus {
  const next: Record<string, UnitStatus> = {
    'collected:test': 'tested',
    'tested:release': 'available',
    'available:reserve': 'reserved',
    'reserved:issue': 'issued',
    'available:issue': 'issued',
    'issued:transfuse': 'transfused',
  };
  if (action === 'expire' && !['transfused', 'expired', 'discarded'].includes(from)) return 'expired';
  if (action === 'discard' && !['transfused', 'discarded'].includes(from)) return 'discarded';
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`BANK_TRANSITION:${from}->${action}`);
  return to;
}

export const BLOODBANK_REPOSITORY = 'BLOODBANK_REPOSITORY';

export interface BloodbankRepository {
  registerUnit(input: {
    bagId: string;
    abo: ABO;
    rh: Rh;
    expiresOn: string;
  }): Promise<{ id: string }>;
  findUnit(id: string): Promise<
    | { id: string; abo: ABO; rh: Rh; expiresOn?: string; status: UnitStatus }
    | undefined
  >;
  setUnitStatus(id: string, status: UnitStatus): Promise<void>;
  recordCrossmatch(input: {
    patientId: string;
    unitId: string;
    result: 'compatible' | 'incompatible';
    performedBy?: string;
  }): Promise<{ id: string }>;
  latestCrossmatch(patientId: string, unitId: string): Promise<{ result: string } | undefined>;
  startTransfusion(input: { patientId: string; encounterId?: string; unitId: string }): Promise<{ id: string }>;
  finishTransfusion(
    id: string,
    outcome: { status: 'completed' | 'stopped'; reaction?: string; note?: string },
  ): Promise<void>;
}
