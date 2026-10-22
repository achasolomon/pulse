import type {
  StaffPatientIdentity,
  StaffPatientPage,
} from '@pulse/api-contracts';
export const STAFF_PATIENT_READ_REPOSITORY = 'STAFF_PATIENT_READ_REPOSITORY';
export interface PatientReadScope {
  personId: string;
  organizationId: string;
  facilityId: string;
  privileges: string[];
}
export interface StaffPatientReadRepository {
  list(
    scope: PatientReadScope,
    query: string,
    status: string,
    cursor?: string,
  ): Promise<StaffPatientPage>;
  identity(
    scope: PatientReadScope,
    id: string,
  ): Promise<StaffPatientIdentity | undefined>;
}
