import type { StaffChartOverview } from '@pulse/api-contracts';
export const STAFF_CHART_REPOSITORY = 'STAFF_CHART_REPOSITORY';
export interface StaffChartRepository {
  sections(input: {
    personId: string;
    organizationId: string;
    facilityId: string;
    patientId: string;
    observations: boolean;
    entries: boolean;
  }): Promise<Pick<StaffChartOverview, 'observations' | 'entries'>>;
}
