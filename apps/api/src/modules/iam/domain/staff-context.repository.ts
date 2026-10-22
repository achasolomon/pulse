import type { StaffFacilityContext } from '@pulse/api-contracts';

export const STAFF_CONTEXT_REPOSITORY = 'STAFF_CONTEXT_REPOSITORY';

export interface StaffContextRepository {
  listFacilities(personId: string): Promise<StaffFacilityContext[]>;
}
