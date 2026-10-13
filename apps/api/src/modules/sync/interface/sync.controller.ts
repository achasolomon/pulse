import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { SyncService } from '../application/sync.service.js';
import { DeviceService } from '../application/device.service.js';
import type { Device } from '../domain/device.repository.js';
import { SyncAccessGuard, type DeviceRequest } from './sync-access.guard.js';

export class ApplyBatchDto {
  @IsArray()
  events!: {
    eventId: string;
    type: string;
    aggregateId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }[];
}

export class ResolveConflictDto {
  @IsString()
  resolution!: string;
}

export class EnrollDeviceDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  @Length(2, 64)
  name!: string;

  @IsOptional()
  @IsIn(['edge-gateway', 'branch-server', 'kiosk'])
  kind?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  capabilities!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  maxDisconnectedHours?: number;
}

export class HeartbeatDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  pendingOut?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  pendingIn?: number;

  @IsOptional()
  @IsISO8601()
  lastSyncAt?: string;
}

/**
 * Edge sync + device runtime surface (EPIC-21). Dual-path access via
 * SyncAccessGuard: enrolled device token (service identity, capability
 * scoped) or staff/demo session (tenant context + privileges).
 */
@Controller('sync')
@UseGuards(SyncAccessGuard)
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly devices: DeviceService,
  ) {}

  @Get('feed')
  @RequirePrivilege({ action: 'read', resourceType: 'sync' })
  feed(
    @Req() req: DeviceRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('consumerId') consumerId?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);
    const device = req.edgeDevice;
    return this.sync.feed(
      cursor ?? '',
      n,
      device ? `device:${device.id}` : consumerId ?? 'edge-default',
      device?.capabilities,
    );
  }

  @Post('apply')
  @RequirePrivilege({ action: 'write', resourceType: 'sync' })
  @Audited({ action: 'sync.apply', resourceType: 'sync_batch' })
  apply(
    @Req() req: DeviceRequest,
    @Body() dto: ApplyBatchDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.sync.apply(dto.events, {
      correlationId: ctx?.correlationId,
      ...(req.edgeDevice ? { capabilities: req.edgeDevice.capabilities } : {}),
    });
  }

  @Get('conflicts')
  @RequirePrivilege({ action: 'read', resourceType: 'sync' })
  conflicts() {
    return this.sync.openConflicts();
  }

  @Post('conflicts/:id/resolve')
  @RequirePrivilege({ action: 'resolve', resourceType: 'sync' })
  @Audited({ action: 'sync.resolve', resourceType: 'sync_conflict' })
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveConflictDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.sync.resolveConflict(id, dto.resolution, {
      correlationId: ctx?.correlationId,
    });
  }

  @Post('devices')
  @RequirePrivilege({ action: 'manage', resourceType: 'sync' })
  @Audited({ action: 'device.enroll', resourceType: 'edge_device' })
  enroll(@Body() dto: EnrollDeviceDto, @CurrentContext() ctx?: RequestContext) {
    return this.devices.enroll({
      facilityId: dto.facilityId,
      name: dto.name,
      ...(dto.kind ? { kind: dto.kind } : {}),
      capabilities: dto.capabilities,
      ...(dto.maxDisconnectedHours !== undefined
        ? { maxDisconnectedHours: dto.maxDisconnectedHours }
        : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('devices')
  @RequirePrivilege({ action: 'read', resourceType: 'sync' })
  list(@CurrentContext() ctx?: RequestContext) {
    return this.devices.list(ctx?.facilityId);
  }

  @Get('devices/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'sync' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    const device = await this.devices.get(id);
    if (ctx?.facilityId && device.facilityId !== ctx.facilityId) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Unknown device id' });
    }
    return device;
  }

  @Post('devices/:id/suspend')
  @RequirePrivilege({ action: 'manage', resourceType: 'sync' })
  @Audited({ action: 'device.suspend', resourceType: 'edge_device' })
  suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.transition(id, 'suspend', ctx);
  }

  @Post('devices/:id/resume')
  @RequirePrivilege({ action: 'manage', resourceType: 'sync' })
  @Audited({ action: 'device.resume', resourceType: 'edge_device' })
  resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.transition(id, 'resume', ctx);
  }

  @Post('devices/:id/decommission')
  @RequirePrivilege({ action: 'manage', resourceType: 'sync' })
  @Audited({ action: 'device.decommission', resourceType: 'edge_device' })
  decommission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.transition(id, 'decommission', ctx);
  }

  @Post('devices/me/heartbeat')
  heartbeat(@Req() req: Request, @Body() dto: HeartbeatDto) {
    const device = (req as Request & { edgeDevice?: Device }).edgeDevice;
    if (!device) {
      throw new UnauthorizedException({
        code: 'DEVICE_TOKEN_REQUIRED',
        message: 'x-device-token is required for heartbeats',
      });
    }
    return this.devices.heartbeat(device, dto);
  }

  private async transition(
    id: string,
    action: 'suspend' | 'resume' | 'decommission',
    ctx?: RequestContext,
  ) {
    const existing = await this.devices.get(id);
    if (ctx?.facilityId && existing.facilityId !== ctx.facilityId) {
      throw new ForbiddenException({
        code: 'DEVICE_FACILITY_SCOPE',
        message: 'Device belongs to another facility',
      });
    }
    return this.devices.setStatusAction(
      id,
      action,
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }
}
