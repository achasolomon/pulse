/** Laboratory domain (LAB-001 sections 6-11, EPIC-10). */

export type LabOrderStatus =
  | 'ordered'
  | 'collected'
  | 'accessioned'
  | 'resulted'
  | 'verified'
  | 'cancelled';

export type LabUrgency = 'stat' | 'urgent' | 'routine';

export interface LabTest {
  id: string;
  code: string;
  name: string;
  specimenRequirement: string;
  version: number;
  active: boolean;
}

export interface LabOrder {
  id: string;
  patientId: string;
  encounterId: string;
  testId: string;
  testVersion: number;
  urgency: LabUrgency;
  status: LabOrderStatus;
}

/** Pure order machine. Throws Error('LAB_TRANSITION:...') on illegal moves. */
export function transitionLabOrder(
  from: LabOrderStatus,
  action: 'collect' | 'accession' | 'result' | 'verify' | 'cancel',
): LabOrderStatus {
  if (action === 'cancel') {
    if (from === 'verified' || from === 'cancelled') {
      throw new Error(`LAB_TRANSITION:${from}->${action}`);
    }
    return 'cancelled';
  }
  const next: Record<string, LabOrderStatus> = {
    'ordered:collect': 'collected',
    'collected:accession': 'accessioned',
    'accessioned:result': 'resulted',
    'resulted:result': 'resulted',
    'resulted:verify': 'verified',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`LAB_TRANSITION:${from}->${action}`);
  return to;
}

export const LAB_REPOSITORY = 'LAB_REPOSITORY';

export interface LabRepository {
  upsertTest(input: {
    code: string;
    name: string;
    specimenRequirement: string;
  }): Promise<LabTest>;
  findTest(code: string): Promise<LabTest | undefined>;
  order(input: {
    patientId: string;
    encounterId: string;
    testId: string;
    testVersion: number;
    urgency: LabUrgency;
    indication: string;
  }): Promise<LabOrder>;
  findOrder(id: string): Promise<LabOrder | undefined>;
  setStatus(
    id: string,
    status: LabOrderStatus,
    extra?: { cancelReason?: string; verifiedBy?: string },
  ): Promise<LabOrder>;
  collectSpecimen(orderId: string, input: { container: string; label: string }): Promise<{ id: string }>;
  addResult(orderId: string, input: {
    component: string;
    valueText: string;
    unit?: string;
    flag?: 'normal' | 'high' | 'low' | 'critical';
  }): Promise<{ id: string; critical: boolean }>;
  acknowledgeCritical(orderId: string, ackBy: string): Promise<void>;
  worklist(statuses: LabOrderStatus[], limit: number): Promise<LabOrder[]>;
  ordersFor(patientId: string, limit: number): Promise<LabOrder[]>;
}
