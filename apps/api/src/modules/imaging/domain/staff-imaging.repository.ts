import type {
  StaffImagingProcedure,
  StaffImagingOrder,
  StaffImagingOrderInput,
  StaffLabCancellation,
  StaffProblemContext,
} from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_IMAGING_REPOSITORY = 'STAFF_IMAGING_REPOSITORY';
export interface StaffImagingRepository {
  readiness(scope:PatientReadScope,id:string):Promise<import('@pulse/api-contracts').StaffImagingReadiness>;
  changeBooking(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingBookingChangeInput&{slotId?:string},kind:'cancelled'|'rescheduled'|'no-show'):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>;
  arrive(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingArrivalInput):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>;
  slots(scope:PatientReadScope,id:string,from:string,to:string):Promise<{items:import('@pulse/api-contracts').StaffImagingSlot[];hasMore:boolean}>;
  schedule(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingScheduleInput):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>;
  protocols(scope:PatientReadScope,id:string):Promise<import('@pulse/api-contracts').StaffImagingProtocolTemplate[]>;
  reviewProtocol(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingProtocolInput):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>;
  queue(scope:PatientReadScope,status:string,query:string,cursor?:string):Promise<import('@pulse/api-contracts').StaffImagingQueuePage>;
  dutyGet(scope:PatientReadScope,id:string):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>;
  catalogue(
    scope: PatientReadScope,
    patientId: string,
    query: string,
  ): Promise<{ items: StaffImagingProcedure[]; hasMore: boolean }>;
  contexts(
    scope: PatientReadScope,
    patientId: string,
  ): Promise<StaffProblemContext[]>;
  get(
    scope: PatientReadScope,
    patientId: string,
    id: string,
  ): Promise<StaffImagingOrder>;
  order(
    scope: PatientReadScope,
    patientId: string,
    input: StaffImagingOrderInput,
  ): Promise<StaffImagingOrder>;
  cancel(
    scope: PatientReadScope,
    patientId: string,
    id: string,
    input: StaffLabCancellation,
  ): Promise<StaffImagingOrder>;
}
