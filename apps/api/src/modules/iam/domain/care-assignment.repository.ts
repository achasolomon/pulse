export const CARE_ASSIGNMENT_REPOSITORY = 'CARE_ASSIGNMENT_REPOSITORY';

export interface CareAssignment {
  id: string;
}

/**
 * Care-assignment lookup (IAM-001 §18). Clinical domains remain authoritative
 * for care truth; this registry is what the policy engine consumes.
 */
export interface CareAssignmentRepository {
  findActive(input: {
    patientId: string;
    personId: string;
    facilityId: string;
  }): Promise<CareAssignment | undefined>;
  create(input: {
    patientId: string;
    personId: string;
    facilityId: string;
    kind: string;
    encounterId?: string;
    effectiveFrom?: Date;
    effectiveTo?: Date;
  }): Promise<CareAssignment>;
}
