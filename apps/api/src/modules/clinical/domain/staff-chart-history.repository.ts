import type {
  StaffChartSection,
  StaffChartHistoryPage,
} from '@pulse/api-contracts';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
export const STAFF_CHART_HISTORY_REPOSITORY = 'STAFF_CHART_HISTORY_REPOSITORY';
export interface StaffChartHistoryRepository {
  read(
    scope: PatientReadScope,
    patientId: string,
    section: StaffChartSection,
    cursor?: string,
    encounterId?: string,
  ): Promise<StaffChartHistoryPage>;
}
