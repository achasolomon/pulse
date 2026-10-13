/** Reporting domain (ARCH-001 section 24, EPIC-20 baseline). Derived read models only; writes nothing. */

export interface CensusRow {
  status: string;
  departmentId?: string;
  count: number;
}

export interface RevenueSummary {
  charges: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

export interface ClaimAgingRow {
  status: string;
  count: number;
}

export const REPORTS_REPOSITORY = 'REPORTS_REPOSITORY';

export interface ReportsRepository {
  census(facilityId: string): Promise<CensusRow[]>;
  revenue(facilityId: string, from: string, to: string): Promise<RevenueSummary>;
  claimAging(facilityId: string): Promise<ClaimAgingRow[]>;
}
