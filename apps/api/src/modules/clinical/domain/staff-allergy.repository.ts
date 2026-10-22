import type {StaffAllergyRecord,StaffAllergyInput,StaffAllergyReviewInput,StaffAllergyCorrectionInput} from '@pulse/api-contracts';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_ALLERGY_REPOSITORY='STAFF_ALLERGY_REPOSITORY';
export interface StaffAllergyRepository {
  read(scope:PatientReadScope,patientId:string):Promise<StaffAllergyRecord>;
  add(scope:PatientReadScope,patientId:string,input:StaffAllergyInput):Promise<StaffAllergyRecord>;
  review(scope:PatientReadScope,patientId:string,input:StaffAllergyReviewInput):Promise<StaffAllergyRecord>;
  correct(scope:PatientReadScope,patientId:string,id:string,input:StaffAllergyCorrectionInput):Promise<StaffAllergyRecord>;
}
