/** Patient domain (CLIN-001 section 4, DB-001 sections 11-13). */

export type PatientStatus = 'active' | 'retired-duplicate';

export interface Patient {
  id: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O' | 'U';
  facilityId: string;
  status: PatientStatus;
}

export interface PatientIdentifier {
  system: string;
  value: string;
  facilityId?: string;
}

export type DuplicateRisk = 'CONFIRMED' | 'REVIEW' | 'NONE';

export interface DuplicateCandidate {
  patientId: string;
  risk: DuplicateRisk;
  reasons: string[];
}

export interface PatientSummary extends Patient {
  identifiers: PatientIdentifier[];
  mergedInto?: string;
}
