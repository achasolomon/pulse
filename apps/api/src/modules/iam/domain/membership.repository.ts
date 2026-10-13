import type { Membership } from './types.js';

export const MEMBERSHIP_REPOSITORY = 'MEMBERSHIP_REPOSITORY';

export interface MembershipRepository {
  findActive(
    personId: string,
    facilityId: string,
  ): Promise<Membership | undefined>;
  create(input: {
    personId?: string;
    accountName?: string;
    organizationId: string;
    facilityId: string;
    roles: string[];
    privileges: string[];
  }): Promise<Membership>;
}
