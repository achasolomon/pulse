import type {StaffLabDutyOrder,StaffLabQueuePage,StaffLabCollection,StaffLabAccession,StaffLabResultInput,StaffLabVerification} from '@pulse/api-contracts';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_LAB_WORKFLOW_REPOSITORY='STAFF_LAB_WORKFLOW_REPOSITORY';
export interface StaffLabWorkflowRepository {
  queue(scope:PatientReadScope,status:string,query:string,cursor?:string):Promise<StaffLabQueuePage>;
  get(scope:PatientReadScope,id:string):Promise<StaffLabDutyOrder>;
  collect(scope:PatientReadScope,id:string,input:StaffLabCollection):Promise<StaffLabDutyOrder>;
  accession(scope:PatientReadScope,id:string,input:StaffLabAccession):Promise<StaffLabDutyOrder>;
  result(scope:PatientReadScope,id:string,input:StaffLabResultInput):Promise<StaffLabDutyOrder>;
  verify(scope:PatientReadScope,id:string,input:StaffLabVerification):Promise<StaffLabDutyOrder>;
}
