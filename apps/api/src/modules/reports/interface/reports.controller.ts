import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ReportsService } from '../application/reports.service.js';

/** Operational reports (EPIC-20 baseline). Facility-scoped reads. */
@Controller('reports')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('census')
  @RequirePrivilege({ action: 'read', resourceType: 'report' })
  census(@Query('facilityId') facilityId: string) {
    return this.reports.census(facilityId);
  }

  @Get('revenue')
  @RequirePrivilege({ action: 'read', resourceType: 'report' })
  revenue(
    @Query('facilityId') facilityId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.revenue(facilityId, from, to);
  }

  @Get('claims')
  @RequirePrivilege({ action: 'read', resourceType: 'report' })
  claims(@Query('facilityId') facilityId: string) {
    return this.reports.claims(facilityId);
  }
}
