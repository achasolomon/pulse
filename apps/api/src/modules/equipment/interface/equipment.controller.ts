import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { EquipmentService } from '../application/equipment.service.js';
import type { AssetStatus, MaintenanceKind, MaintenanceStatus } from '../domain/equipment.repository.js';

export class CommissionAssetDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsString()
  @Length(1, 100)
  manufacturer!: string;

  @IsString()
  @Length(1, 100)
  model!: string;

  @IsString()
  @Length(3, 64)
  serial!: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
}

export class ReasonDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class NoteDto {
  @IsOptional()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class ScheduleMaintenanceDto {
  @IsIn(['preventive', 'calibration', 'corrective'])
  kind!: MaintenanceKind;

  @IsISO8601()
  dueAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  intervalDays?: number;
}

/**
 * Equipment / asset lifecycle (EPIC-25, INV-001 section 40). Staff surface:
 * tenant context + privileges equipment:read / equipment:manage.
 */
@Controller('equipment')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Post('assets')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.commission', resourceType: 'equipment_asset' })
  commission(@Body() dto: CommissionAssetDto, @CurrentContext() ctx?: RequestContext) {
    return this.equipment.commission({
      facilityId: dto.facilityId,
      name: dto.name,
      manufacturer: dto.manufacturer,
      model: dto.model,
      serial: dto.serial,
      ...(dto.purchaseOrderId ? { purchaseOrderId: dto.purchaseOrderId } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('assets')
  @RequirePrivilege({ action: 'read', resourceType: 'equipment' })
  listAssets(@Query('facilityId') facilityId?: string, @Query('status') status?: string) {
    return this.equipment.listAssets({
      ...(facilityId ? { facilityId } : {}),
      ...(status === 'in_service' || status === 'out_of_service' || status === 'retired'
        ? { status: status as AssetStatus }
        : {}),
    });
  }

  @Get('assets/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'equipment' })
  getAsset(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.equipment.getAsset(id);
  }

  @Post('assets/:id/out-of-service')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.out_of_service', resourceType: 'equipment_asset' })
  outOfService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.equipment.takeOutOfService(id, {
      reason: dto.reason,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('assets/:id/in-service')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.in_service', resourceType: 'equipment_asset' })
  inService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NoteDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.equipment.returnToService(id, {
      ...(dto.note ? { note: dto.note } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('assets/:id/retire')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.retire', resourceType: 'equipment_asset' })
  retire(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NoteDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.equipment.retire(id, {
      ...(dto.note ? { note: dto.note } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('assets/:id/maintenance')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.maintenance_schedule', resourceType: 'equipment_asset' })
  schedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ScheduleMaintenanceDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.equipment.scheduleMaintenance(id, {
      kind: dto.kind,
      dueAt: dto.dueAt,
      ...(dto.intervalDays !== undefined ? { intervalDays: dto.intervalDays } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('assets/:id/maintenance')
  @RequirePrivilege({ action: 'read', resourceType: 'equipment' })
  listAssetMaintenance(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.equipment.listMaintenance({ assetId: id });
  }

  @Get('maintenance')
  @RequirePrivilege({ action: 'read', resourceType: 'equipment' })
  listMaintenance(@Query('assetId') assetId?: string, @Query('status') status?: string) {
    return this.equipment.listMaintenance({
      ...(assetId ? { assetId } : {}),
      ...(status === 'scheduled' || status === 'completed' || status === 'cancelled'
        ? { status: status as MaintenanceStatus }
        : {}),
    });
  }

  @Post('maintenance/:id/complete')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.maintenance_complete', resourceType: 'equipment_asset' })
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NoteDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.equipment.completeMaintenance(id, {
      ...(dto.note ? { note: dto.note } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('maintenance/:id/cancel')
  @RequirePrivilege({ action: 'manage', resourceType: 'equipment' })
  @Audited({ action: 'equipment.maintenance_cancel', resourceType: 'equipment_asset' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.equipment.cancelMaintenance(
      id,
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }
}
