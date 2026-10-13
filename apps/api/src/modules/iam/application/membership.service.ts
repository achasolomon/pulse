import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  MEMBERSHIP_REPOSITORY,
  type MembershipRepository,
} from '../domain/membership.repository.js';
import type { Membership } from '../domain/types.js';

/**
 * Resolves the caller's membership for a facility (F03.2).
 * Without a DB (unit/e2e) returns undefined so guards fall back to the
 * demo header contract; production requires DB membership.
 */
@Injectable()
export class MembershipService {
  constructor(
    @Optional()
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly repo?: MembershipRepository,
  ) {}

  findActive(
    personId: string,
    facilityId: string,
  ): Promise<Membership | undefined> {
    if (!process.env.DATABASE_URL || !this.repo) return Promise.resolve(undefined);
    return this.repo.findActive(personId, facilityId);
  }
}
