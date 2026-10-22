import type { OutpatientVisit, ConsultationStaff } from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const OUTPATIENT_REPOSITORY = 'OUTPATIENT_REPOSITORY';
export interface OutpatientRepository {
  list(
    scope: PatientReadScope,
    queue: 'reception' | 'vitals' | 'consultation',
  ): Promise<OutpatientVisit[]>;
  get(scope: PatientReadScope, id: string): Promise<OutpatientVisit>;
  current(
    scope: PatientReadScope,
    patientId: string,
  ): Promise<OutpatientVisit | null>;
  clinicians(scope: PatientReadScope): Promise<ConsultationStaff[]>;
  checkIn(
    scope: PatientReadScope,
    input: { patientId: string; appointmentId?: string; commandKey: string },
  ): Promise<OutpatientVisit>;
  move(
    scope: PatientReadScope,
    id: string,
    action: 'claim' | 'handoff' | 'start',
    key: string,
    clinicianId?: string,
  ): Promise<OutpatientVisit>;
}
