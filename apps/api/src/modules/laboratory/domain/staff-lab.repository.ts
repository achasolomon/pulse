import type {StaffLabTest,StaffLabOrder,StaffLabOrderInput,StaffLabCancellation,StaffProblemContext} from '@pulse/api-contracts';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_LAB_REPOSITORY='STAFF_LAB_REPOSITORY';
export interface StaffLabRepository {
  catalogue(scope:PatientReadScope,patientId:string,query:string):Promise<{items:StaffLabTest[];hasMore:boolean}>;
  contexts(scope:PatientReadScope,patientId:string):Promise<StaffProblemContext[]>;
  get(scope:PatientReadScope,patientId:string,id:string):Promise<StaffLabOrder>;
  order(scope:PatientReadScope,patientId:string,input:StaffLabOrderInput):Promise<StaffLabOrder>;
  cancel(scope:PatientReadScope,patientId:string,id:string,input:StaffLabCancellation):Promise<StaffLabOrder>;
}
