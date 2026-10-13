/** Pentest/security findings domain (SEC-001 section 86, F22.1). */

export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'triaged' | 'mitigated' | 'accepted';
export type FindingAction = 'triage' | 'mitigate' | 'accept';

export interface Finding {
  id: string;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
  vector?: string;
  component: string;
  evidence?: string;
  owner?: string;
  remediation?: string;
  foundAt: string;
  triagedAt?: string;
  triagedBy?: string;
  dueAt?: string;
}

export const FINDING_REPOSITORY = 'FINDING_REPOSITORY';

export interface FindingRepository {
  create(input: {
    title: string;
    severity: FindingSeverity;
    component: string;
    vector?: string;
    evidence?: string;
    owner?: string;
    remediation?: string;
    dueAt?: string;
  }): Promise<Finding>;
  findById(id: string): Promise<Finding | undefined>;
  list(filter?: { status?: FindingStatus; severity?: FindingSeverity }): Promise<Finding[]>;
  transition(
    id: string,
    status: FindingStatus,
    input: { owner?: string; remediation?: string; triagedBy?: string; at: Date },
  ): Promise<void>;
}

/**
 * Finding triage state machine (F22.1): open may be triaged, mitigated or
 * accepted directly; triaged findings close via mitigate/accept;
 * mitigated/accepted are terminal (regressions are new findings).
 */
export function findingStatusAction(
  status: FindingStatus,
  action: FindingAction,
): FindingStatus | undefined {
  switch (action) {
    case 'triage':
      return status === 'open' ? 'triaged' : undefined;
    case 'mitigate':
      return status === 'open' || status === 'triaged' ? 'mitigated' : undefined;
    case 'accept':
      return status === 'open' || status === 'triaged' ? 'accepted' : undefined;
    default:
      return undefined;
  }
}

const SEVERITIES = new Set<FindingSeverity>(['info', 'low', 'medium', 'high', 'critical']);

export function validateFindingSeverity(value: string): FindingSeverity {
  if (!SEVERITIES.has(value as FindingSeverity)) {
    throw new Error('FINDING_SEVERITY_INVALID');
  }
  return value as FindingSeverity;
}
