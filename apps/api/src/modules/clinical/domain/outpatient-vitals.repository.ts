import type { VitalMeasurement } from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const OUTPATIENT_VITALS_REPOSITORY = 'OUTPATIENT_VITALS_REPOSITORY';
export interface OutpatientVitalsRepository {
  record(
    scope: PatientReadScope,
    visitId: string,
    input: {
      measurements: VitalMeasurement[];
      takenAt: string;
      commandKey: string;
    },
  ): Promise<{ visitId: string; recorded: number }>;
}
