import type {
  DuplicateCandidate,
  Patient,
  PatientIdentifier,
  PatientSummary,
} from './types.js';

/** MRN system URI builder: facility-scoped namespace (FHIR-001 section 8). */
export function mrnSystem(facilityId: string): string {
  return `urn:pulse:mrn:${facilityId}`;
}

export interface RegisterPatientInput {
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  sex: 'M' | 'F' | 'O' | 'U';
  facilityId: string;
  mrn?: string;
  externalIdentifiers?: PatientIdentifier[];
}

/**
 * Deterministic duplicate scoring (F04.3). Pure function, unit-tested.
 * - Exact identifier value match (any system) -> CONFIRMED.
 * - Same normalized surname + exact DOB -> REVIEW.
 * - Otherwise NONE. Never auto-merges — callers present candidates for review.
 */
export function scoreDuplicates(
  candidate: { familyName: string; dateOfBirth: string },
  existing: {
    patientId: string;
    familyName: string;
    dateOfBirth: string;
    identifiers: PatientIdentifier[];
  }[],
  identifiers: PatientIdentifier[],
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const norm = (s: string) => s.trim().toLowerCase();
  const idValues = new Set(identifiers.map((i) => i.value.trim()));
  for (const e of existing) {
    const reasons: string[] = [];
    if (e.identifiers.some((i) => idValues.has(i.value.trim()))) {
      reasons.push('identifier-match');
    }
    if (norm(e.familyName) === norm(candidate.familyName) && e.dateOfBirth === candidate.dateOfBirth) {
      reasons.push('surname-dob-match');
    }
    if (reasons.length === 0) continue;
    out.push({
      patientId: e.patientId,
      risk: reasons.includes('identifier-match') ? 'CONFIRMED' : 'REVIEW',
      reasons,
    });
  }
  return out;
}

export const PATIENT_REPOSITORY = 'PATIENT_REPOSITORY';

export interface PatientRepository {
  create(
    input: RegisterPatientInput & { identifiers: PatientIdentifier[] },
  ): Promise<Patient>;
  findById(id: string): Promise<PatientSummary | undefined>;
  /**
   * Exact identifier-value matches (FHIR-001 section 62 identity resolution).
   * Returns distinct patient ids — 0 matches or >1 distinct patients are the
   * caller's problem (never guessed; ambiguity needs governed matching).
   */
  findByIdentifierValue(value: string): Promise<{ id: string }[]>;
  search(input: {
    query: string;
    facilityId: string;
    limit: number;
  }): Promise<PatientSummary[]>;
  /** Candidates for duplicate review within a facility (bounded scan). */
  listFacilityPatients(facilityId: string, limit: number): Promise<
    {
      patientId: string;
      familyName: string;
      dateOfBirth: string;
      identifiers: PatientIdentifier[];
    }[]
  >;
  merge(input: {
    survivorId: string;
    duplicateId: string;
    reason: string;
    mergedBy?: string;
  }): Promise<void>;
  findMergeTarget(duplicateId: string): Promise<string | undefined>;
  setGuarantor(id: string, input: { name: string; contact?: string }): Promise<void>;
}
