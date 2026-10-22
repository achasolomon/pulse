import type {
  StaffCriticalCase,
  StaffCriticalDetail,
  StaffCriticalNotify,
  StaffCriticalAttempt,
  StaffCriticalAck,
  StaffCriticalBackup,
} from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_CRITICAL_REPOSITORY = 'STAFF_CRITICAL_REPOSITORY';
export interface StaffCriticalRepository {
  backup(scope:PatientReadScope,id:string,input:StaffCriticalBackup):Promise<StaffCriticalDetail>;
  processDue():Promise<number>;
  queue(
    scope: PatientReadScope,
    cursor?: string,
  ): Promise<{ items: StaffCriticalCase[]; nextCursor: string | null }>;
  count(scope: PatientReadScope): Promise<{ pending: number; overdue: number }>;
  get(scope: PatientReadScope, id: string): Promise<StaffCriticalDetail>;
  recipients(
    scope: PatientReadScope,
    id: string,
  ): Promise<{ id: string; label: string }[]>;
  notify(
    scope: PatientReadScope,
    id: string,
    input: StaffCriticalNotify,
  ): Promise<StaffCriticalDetail>;
  attempt(
    scope: PatientReadScope,
    id: string,
    input: StaffCriticalAttempt,
  ): Promise<StaffCriticalDetail>;
  acknowledge(
    scope: PatientReadScope,
    id: string,
    input: StaffCriticalAck,
  ): Promise<StaffCriticalDetail>;
}
