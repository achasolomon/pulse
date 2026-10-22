import type { StaffProblemEntry, StaffProblemInput, StaffProblemResolution, StaffProblemContext } from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_ENTRY_REPOSITORY = 'STAFF_ENTRY_REPOSITORY';
export interface StaffEntryRepository {
  contexts(scope: PatientReadScope, patientId: string): Promise<StaffProblemContext[]>;
  get(scope: PatientReadScope, patientId: string, id: string): Promise<StaffProblemEntry>;
  create(scope: PatientReadScope, patientId: string, input: StaffProblemInput): Promise<StaffProblemEntry>;
  resolve(scope: PatientReadScope, patientId: string, id: string, input: StaffProblemResolution): Promise<StaffProblemEntry>;
}
