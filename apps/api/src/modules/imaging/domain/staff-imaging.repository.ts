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
