import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Department,
  Facility,
  Location,
  LocationKind,
  Unit,
} from '../domain/types.js';
import type { OrganizationRepository } from '../application/organization.repository.js';

/** Kysely implementation (ADR-006). Lives in infrastructure — never imported cross-domain. */
@Injectable()
export class KyselyOrganizationRepository implements OrganizationRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createOrganization(input: { name: string; code: string }) {
    const row = await this.db
      .insertInto('org.organization')
      .values({ name: input.name, code: input.code })
      .returning(['id', 'name', 'code'])
      .executeTakeFirstOrThrow();
    return { id: row.id, name: row.name, code: row.code };
  }

  async createFacility(input: {
    organizationId: string;
    name: string;
    code: string;
  }): Promise<Facility> {
    const row = await this.db
      .insertInto('org.facility')
      .values({
        organization_id: input.organizationId,
        name: input.name,
        code: input.code,
      })
      .returning(['id', 'organization_id', 'name', 'code'])
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      code: row.code,
    };
  }

  async listFacilities(organizationId: string): Promise<Facility[]> {
    const rows = await this.db
      .selectFrom('org.facility')
      .select(['id', 'organization_id', 'name', 'code'])
      .where('organization_id', '=', organizationId)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      code: r.code,
    }));
  }

  async findFacilityById(id: string): Promise<Facility | undefined> {
    const r = await this.db
      .selectFrom('org.facility')
      .select(['id', 'organization_id', 'name', 'code'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      code: r.code,
    };
  }

  async createDepartment(input: {
    facilityId: string;
    name: string;
    code: string;
    parentDepartmentId?: string;
  }): Promise<Department> {
    const row = await this.db
      .insertInto('org.department')
      .values({
        facility_id: input.facilityId,
        name: input.name,
        code: input.code,
        parent_department_id: input.parentDepartmentId ?? null,
      })
      .returning(['id', 'facility_id', 'name', 'code', 'parent_department_id'])
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      facilityId: row.facility_id,
      name: row.name,
      code: row.code,
      ...(row.parent_department_id
        ? { parentDepartmentId: row.parent_department_id }
        : {}),
    };
  }

  async listDepartments(facilityId: string): Promise<Department[]> {
    const rows = await this.db
      .selectFrom('org.department')
      .select(['id', 'facility_id', 'name', 'code', 'parent_department_id'])
      .where('facility_id', '=', facilityId)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      facilityId: r.facility_id,
      name: r.name,
      code: r.code,
      ...(r.parent_department_id
        ? { parentDepartmentId: r.parent_department_id }
        : {}),
    }));
  }

  async createUnit(input: {
    facilityId: string;
    name: string;
    code: string;
  }): Promise<Unit> {
    const row = await this.db
      .insertInto('org.unit')
      .values({ facility_id: input.facilityId, name: input.name, code: input.code })
      .returning(['id', 'facility_id', 'name', 'code'])
      .executeTakeFirstOrThrow();
    return { id: row.id, facilityId: row.facility_id, name: row.name, code: row.code };
  }

  async listUnits(facilityId: string): Promise<Unit[]> {
    const rows = await this.db
      .selectFrom('org.unit')
      .select(['id', 'facility_id', 'name', 'code'])
      .where('facility_id', '=', facilityId)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      facilityId: r.facility_id,
      name: r.name,
      code: r.code,
    }));
  }

  async createLocation(input: {
    unitId: string;
    facilityId: string;
    name: string;
    code: string;
    kind: LocationKind;
  }): Promise<Location> {
    const row = await this.db
      .insertInto('org.location')
      .values({
        unit_id: input.unitId,
        facility_id: input.facilityId,
        name: input.name,
        code: input.code,
        kind: input.kind,
      })
      .returning(['id', 'unit_id', 'facility_id', 'name', 'code', 'kind'])
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      unitId: row.unit_id,
      facilityId: row.facility_id,
      name: row.name,
      code: row.code,
      kind: row.kind as LocationKind,
    };
  }

  async listLocations(unitId: string): Promise<Location[]> {
    const rows = await this.db
      .selectFrom('org.location')
      .select(['id', 'unit_id', 'facility_id', 'name', 'code', 'kind'])
      .where('unit_id', '=', unitId)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      unitId: r.unit_id,
      facilityId: r.facility_id,
      name: r.name,
      code: r.code,
      kind: r.kind as LocationKind,
    }));
  }
}
