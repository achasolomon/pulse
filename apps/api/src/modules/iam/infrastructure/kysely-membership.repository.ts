import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  MembershipRepository,
} from '../domain/membership.repository.js';
import type { Membership } from '../domain/types.js';

@Injectable()
export class KyselyMembershipRepository implements MembershipRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async findActive(
    personId: string,
    facilityId: string,
  ): Promise<Membership | undefined> {
    const r = await this.db
      .selectFrom('iam.membership')
      .select([
        'id',
        'person_id',
        'organization_id',
        'facility_id',
        'roles',
        'privileges',
        'department_id',
      ])
      .where('person_id', '=', personId)
      .where('facility_id', '=', facilityId)
      .where((eb) =>
        eb.or([
          eb('effective_from', 'is', null),
          eb('effective_from', '<=', new Date()),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>', new Date()),
        ]),
      )
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      membershipId: r.id,
      personId: r.person_id ?? personId,
      organizationId: r.organization_id,
      facilityId: r.facility_id,
      roles: r.roles,
      privileges: r.privileges,
      ...(r.department_id ? { departmentId: r.department_id } : {}),
    };
  }

  async create(input: {
    personId?: string;
    accountName?: string;
    organizationId: string;
    facilityId: string;
    roles: string[];
    privileges: string[];
    departmentId?: string;
  }): Promise<Membership> {
    const r = await this.db
      .insertInto('iam.membership')
      .values({
        person_id: input.personId ?? null,
        account_name: input.accountName ?? null,
        organization_id: input.organizationId,
        facility_id: input.facilityId,
        roles: input.roles,
        privileges: input.privileges,
        department_id: input.departmentId ?? null,
      })
      .returning([
        'id',
        'person_id',
        'organization_id',
        'facility_id',
        'roles',
        'privileges',
        'department_id',
      ])
      .executeTakeFirstOrThrow();
    return {
      membershipId: r.id,
      personId: r.person_id ?? input.personId ?? '',
      organizationId: r.organization_id,
      facilityId: r.facility_id,
      roles: r.roles,
      privileges: r.privileges,
      ...(r.department_id ? { departmentId: r.department_id } : {}),
    };
  }
}
