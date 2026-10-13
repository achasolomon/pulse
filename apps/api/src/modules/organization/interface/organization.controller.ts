import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { OrganizationService } from '../application/organization.service.js';
import {
  CreateDepartmentDto,
  CreateFacilityDto,
  CreateLocationDto,
  CreateOrganizationDto,
  CreateUnitDto,
} from './dto.js';

/**
 * Org registry (F02.1, F02.2). Bootstrap-safe: creating the first organization
 * has no tenant yet, so POST /organizations is tenant-guard exempt; everything
 * else requires tenant + facility context and facility:manage privilege.
 */
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly orgs: OrganizationService) {}

  @Post()
  @Audited({ action: 'organization.create', resourceType: 'organization' })
  create(@Body() dto: CreateOrganizationDto) {
    return this.orgs.createOrganization(dto);
  }

  @Post(':id/facilities')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'facility' })
  @Audited({ action: 'facility.create', resourceType: 'facility' })
  createFacility(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateFacilityDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.orgs.createFacility({
      organizationId: id,
      name: dto.name,
      code: dto.code,
      correlationId: ctx?.correlationId,
    });
  }

  @Get(':id/facilities')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'read', resourceType: 'facility' })
  listFacilities(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgs.listFacilities(id);
  }

  @Post(':id/departments')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'facility' })
  @Audited({ action: 'department.create', resourceType: 'department' })
  createDepartment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateDepartmentDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.orgs.createDepartment({
      facilityId: id,
      name: dto.name,
      code: dto.code,
      ...(dto.parentDepartmentId
        ? { parentDepartmentId: dto.parentDepartmentId }
        : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get(':id/departments')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'read', resourceType: 'facility' })
  listDepartments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgs.listDepartments(id);
  }

  @Post(':id/units')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'facility' })
  @Audited({ action: 'unit.create', resourceType: 'unit' })
  createUnit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateUnitDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.orgs.createUnit({
      facilityId: id,
      name: dto.name,
      code: dto.code,
      correlationId: ctx?.correlationId,
    });
  }

  @Get(':id/units')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'read', resourceType: 'facility' })
  listUnits(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orgs.listUnits(id);
  }

  @Post(':id/locations')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'facility' })
  @Audited({ action: 'location.create', resourceType: 'location' })
  createLocation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateLocationDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.orgs.createLocation({
      unitId: dto.unitId,
      facilityId: id,
      name: dto.name,
      code: dto.code,
      kind: dto.kind,
      correlationId: ctx?.correlationId,
    });
  }

  @Get(':unitId/locations')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'read', resourceType: 'facility' })
  listLocations(@Param('unitId', new ParseUUIDPipe()) unitId: string) {
    return this.orgs.listLocations(unitId);
  }
}
