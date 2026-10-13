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
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { BedflowService } from '../application/bedflow.service.js';
import type { CareLevel } from '../domain/bedflow.repository.js';

export class ConfigureBedDto {
  @IsUUID()
  locationId!: string;

  @IsIn(['ward', 'hdu', 'icu'])
  levelOfCare!: CareLevel;

  @IsOptional()
  @IsBoolean()
  isolationCapable?: boolean;
}

export class ReasonDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class AssignBedDto {
  @IsUUID()
  encounterId!: string;

  @IsUUID()
  locationId!: string;
}

export class EncounterDto {
  @IsUUID()
  encounterId!: string;
}

export class TransferBedDto extends EncounterDto {
  @IsUUID()
  locationId!: string;
}

export class SetLevelDto extends EncounterDto {
  @IsIn(['ward', 'hdu', 'icu'])
  level!: CareLevel;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

/**
 * ICU/HDU bed-flow (EPIC-25, CLIN-001 section 13). Staff surface: tenant
 * context + privileges bed:read / bed:manage.
 */
@Controller('beds')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class BedflowController {
  constructor(private readonly bedflow: BedflowService) {}

  @Post('configure')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.configure', resourceType: 'bed' })
  configure(@Body() dto: ConfigureBedDto, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.configureBed(dto.locationId, {
      levelOfCare: dto.levelOfCare,
      ...(dto.isolationCapable !== undefined ? { isolationCapable: dto.isolationCapable } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get()
  @RequirePrivilege({ action: 'read', resourceType: 'bed' })
  list(
    @Query('facilityId') facilityId: string,
    @Query('level') level?: string,
    @Query('available') available?: string,
    @Query('isolation') isolation?: string,
  ) {
    const lvl =
      level === 'ward' || level === 'hdu' || level === 'icu' ? (level as CareLevel) : undefined;
    if (available === 'true') {
      return this.bedflow.listAvailableBeds(facilityId, {
        ...(lvl ? { level: lvl } : {}),
        ...(isolation === 'true' ? { isolation: true } : {}),
      });
    }
    return this.bedflow.listBeds(facilityId, lvl ? { level: lvl } : {});
  }

  @Post(':id/out-of-service')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.out_of_service', resourceType: 'bed' })
  outOfService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.bedflow.setOutOfService(id, {
      reason: dto.reason,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post(':id/in-service')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.in_service', resourceType: 'bed' })
  inService(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.returnToService(
      id,
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('assign')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.assign', resourceType: 'bed' })
  assign(@Body() dto: AssignBedDto, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.assignBed({
      encounterId: dto.encounterId,
      locationId: dto.locationId,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('release')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.release', resourceType: 'bed' })
  release(@Body() dto: EncounterDto, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.releaseBed({
      encounterId: dto.encounterId,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('transfer')
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.transfer', resourceType: 'bed' })
  transfer(@Body() dto: TransferBedDto, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.transferBed({
      encounterId: dto.encounterId,
      locationId: dto.locationId,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('assignments')
  @RequirePrivilege({ action: 'read', resourceType: 'bed' })
  assignments(
    @Query('facilityId') facilityId?: string,
    @Query('encounterId') encounterId?: string,
    @Query('status') status?: string,
  ) {
    return this.bedflow.listAssignments({
      ...(facilityId ? { facilityId } : {}),
      ...(encounterId ? { encounterId } : {}),
      ...(status === 'active' || status === 'ended' ? { status } : {}),
    });
  }
}

@Controller('levels')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class LevelController {
  constructor(private readonly bedflow: BedflowService) {}

  @Post()
  @RequirePrivilege({ action: 'manage', resourceType: 'bed' })
  @Audited({ action: 'bedflow.level_set', resourceType: 'bed' })
  set(@Body() dto: SetLevelDto, @CurrentContext() ctx?: RequestContext) {
    return this.bedflow.setLevelOfCare({
      encounterId: dto.encounterId,
      level: dto.level,
      reason: dto.reason,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get(':encounterId')
  @RequirePrivilege({ action: 'read', resourceType: 'bed' })
  get(@Param('encounterId', new ParseUUIDPipe()) encounterId: string) {
    return this.bedflow.getLevelOfCare(encounterId);
  }
}
