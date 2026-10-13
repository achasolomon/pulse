import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import type {
  Department,
  Facility,
  Location,
  LocationKind,
  Organization,
  Unit,
} from '../domain/types.js';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from './organization.repository.js';

/**
 * Organization application service (EPIC-02 F02.1/F02.2/F02.3).
 * Emits outbox facts on create so downstream consumers stay decoupled (ADR-004).
 * F02.2: department/unit/location hierarchy; parent department must be in the
 * same facility (no cross-facility nesting, no self-parent).
 */
@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly repo: OrganizationRepository,
    private readonly outbox: OutboxService,
  ) {}

  async createOrganization(input: {
    name: string;
    code: string;
    correlationId?: string;
  }): Promise<Organization> {
    const org = await this.repo.createOrganization(input);
    await this.outbox.publish({
      aggregateType: 'organization',
      aggregateId: org.id,
      type: 'organization.created',
      producer: 'organization',
      correlationId: input.correlationId,
      payload: { id: org.id, code: org.code },
    });
    return org;
  }

  async createFacility(input: {
    organizationId: string;
    name: string;
    code: string;
    correlationId?: string;
  }): Promise<Facility> {
    const facility = await this.repo.createFacility(input);
    await this.outbox.publish({
      aggregateType: 'facility',
      aggregateId: facility.id,
      type: 'facility.created',
      producer: 'organization',
      correlationId: input.correlationId,
      payload: { id: facility.id, organizationId: facility.organizationId },
    });
    return facility;
  }

  listFacilities(organizationId: string): Promise<Facility[]> {
    return this.repo.listFacilities(organizationId);
  }

  async createDepartment(input: {
    facilityId: string;
    name: string;
    code: string;
    parentDepartmentId?: string;
    correlationId?: string;
  }): Promise<Department> {
    if (input.parentDepartmentId) {
      const siblings = await this.repo.listDepartments(input.facilityId);
      const parent = siblings.find((d) => d.id === input.parentDepartmentId);
      if (!parent) {
        throw new ForbiddenException({
          code: 'PARENT_DEPARTMENT_NOT_IN_FACILITY',
          message: 'Parent department must belong to the same facility',
        });
      }
    }
    const department = await this.repo.createDepartment(input);
    await this.outbox.publish({
      aggregateType: 'department',
      aggregateId: department.id,
      type: 'department.created',
      producer: 'organization',
      correlationId: input.correlationId,
      payload: {
        id: department.id,
        facilityId: department.facilityId,
        code: department.code,
      },
    });
    return department;
  }

  listDepartments(facilityId: string): Promise<Department[]> {
    return this.repo.listDepartments(facilityId);
  }

  async createUnit(input: {
    facilityId: string;
    name: string;
    code: string;
    correlationId?: string;
  }): Promise<Unit> {
    const unit = await this.repo.createUnit(input);
    await this.outbox.publish({
      aggregateType: 'unit',
      aggregateId: unit.id,
      type: 'unit.created',
      producer: 'organization',
      correlationId: input.correlationId,
      payload: { id: unit.id, facilityId: unit.facilityId, code: unit.code },
    });
    return unit;
  }

  listUnits(facilityId: string): Promise<Unit[]> {
    return this.repo.listUnits(facilityId);
  }

  async createLocation(input: {
    unitId: string;
    facilityId: string;
    name: string;
    code: string;
    kind: LocationKind;
    correlationId?: string;
  }): Promise<Location> {
    const units = await this.repo.listUnits(input.facilityId);
    const unit = units.find((u) => u.id === input.unitId);
    if (!unit) {
      throw new ForbiddenException({
        code: 'UNIT_NOT_IN_FACILITY',
        message: 'Unit must belong to the same facility',
      });
    }
    const location = await this.repo.createLocation(input);
    await this.outbox.publish({
      aggregateType: 'location',
      aggregateId: location.id,
      type: 'location.created',
      producer: 'organization',
      correlationId: input.correlationId,
      payload: {
        id: location.id,
        unitId: location.unitId,
        facilityId: location.facilityId,
        code: location.code,
      },
    });
    return location;
  }

  listLocations(unitId: string): Promise<Location[]> {
    return this.repo.listLocations(unitId);
  }
}
