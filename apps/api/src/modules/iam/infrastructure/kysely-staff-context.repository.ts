import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { StaffContextRepository } from '../domain/staff-context.repository.js';

@Injectable()
export class KyselyStaffContextRepository implements StaffContextRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async listFacilities(personId: string) {
    const now = new Date();
    const rows = await this.db
      .selectFrom('iam.membership as m')
      .innerJoin('org.facility as f', 'f.id', 'm.facility_id')
      .innerJoin('org.organization as o', 'o.id', 'm.organization_id')
      .whereRef('f.organization_id', '=', 'm.organization_id')
      .select(['m.id', 'm.organization_id', 'm.facility_id', 'm.department_id',
        'm.roles', 'm.privileges', 'f.name as facility_name', 'f.code as facility_code',
        'o.name as organization_name'])
      .where('m.person_id', '=', personId)
      .where((eb) => eb.or([eb('m.effective_from', 'is', null), eb('m.effective_from', '<=', now)]))
      .where((eb) => eb.or([eb('m.effective_to', 'is', null), eb('m.effective_to', '>', now)]))
      // Match the authorization repository's latest active membership semantics.
      .distinctOn('m.facility_id')
      .orderBy('m.facility_id')
      .orderBy('m.created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      membershipId: r.id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      facilityId: r.facility_id,
      facilityName: r.facility_name,
      facilityCode: r.facility_code,
      roles: r.roles,
      privileges: r.privileges,
      ...(r.department_id ? { departmentId: r.department_id } : {}),
    }));
  }
}
