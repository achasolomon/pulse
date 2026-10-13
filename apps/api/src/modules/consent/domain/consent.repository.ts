/** Consent domain (PRIV-001, IAM-001 consent, EPIC-16, DB-001 section 41). */

export type ConsentPurpose = 'treatment' | 'referral' | 'billing' | 'research' | 'operations';
export type ConsentStatus = 'granted' | 'withdrawn' | 'expired';

export interface Consent {
  id: string;
  patientId: string;
  grantee: string;
  purpose: ConsentPurpose;
  scope: string;
  status: ConsentStatus;
}

export const CONSENT_REPOSITORY = 'CONSENT_REPOSITORY';

export interface ConsentRepository {
  capture(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    scope: string;
    validTo?: string;
  }): Promise<Consent>;
  withdraw(id: string, reason: string): Promise<void>;
  /** Active grant check: status + window + purpose + scope. Pure-server-side gate. */
  canDisclose(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    at?: Date;
  }): Promise<boolean>;
  logDisclosure(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    caseId?: string;
  }): Promise<void>;
}
