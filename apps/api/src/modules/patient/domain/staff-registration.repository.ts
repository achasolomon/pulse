import type {
  PatientRegistrationInput,
  PatientRegistrationResult,
} from '@pulse/api-contracts';
import type { PatientReadScope } from './staff-patient-read.repository.js';
export const STAFF_REGISTRATION_REPOSITORY = 'STAFF_REGISTRATION_REPOSITORY';
export interface StaffRegistrationRepository {
  register(
    scope: PatientReadScope,
    input: PatientRegistrationInput,
  ): Promise<PatientRegistrationResult>;
}
