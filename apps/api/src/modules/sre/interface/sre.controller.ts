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
import {
  IsIn,
  IsObject,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { AlertService } from '../application/alert.service.js';
import { BackupService } from '../application/backup.service.js';

export class RegisterBackupDto {
  @IsIn(['full', 'wal', 'restore_drill'])
  kind!: 'full' | 'wal' | 'restore_drill';

  @IsOptional()
  @IsPositive()
  rpoTargetMinutes?: number;

  @IsOptional()
  @IsPositive()
  rtoTargetSeconds?: number;
}

export class CompleteBackupDto {
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';

  @IsObject()
  evidence!: Record<string, unknown>;
}

/**
 * SRE alerting + backup/restore-drill evidence (OPS-001 sections 43-44,
 * 62-68; F23.1-F23.3). Staff surface: tenant context + privileges
 * sre:read / sre:manage.
 */
@Controller('sre')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class SreController {
  constructor(
    private readonly alerts: AlertService,
    private readonly backups: BackupService,
  ) {}

  @Get('alert-rules')
  @RequirePrivilege({ action: 'read', resourceType: 'sre' })
  rules(@Query('enabled') enabled?: string) {
    return this.alerts.rules(enabled === 'true');
  }

  @Get('alerts')
  @RequirePrivilege({ action: 'read', resourceType: 'sre' })
  listAlerts(
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);
    return this.alerts.alerts({
      ...(state === 'firing' || state === 'resolved' ? { state } : {}),
      limit: n,
    });
  }

  @Post('alerts/evaluate')
  @RequirePrivilege({ action: 'manage', resourceType: 'sre' })
  @Audited({ action: 'alerts.evaluate', resourceType: 'sre_alert' })
  evaluate(@CurrentContext() ctx?: RequestContext) {
    return this.alerts.evaluate(
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Get('backups')
  @RequirePrivilege({ action: 'read', resourceType: 'sre' })
  listBackups(@Query('kind') kind?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);
    return this.backups.list({
      ...(kind === 'full' || kind === 'wal' || kind === 'restore_drill' ? { kind } : {}),
      limit: n,
    });
  }

  @Get('backups/status')
  @RequirePrivilege({ action: 'read', resourceType: 'sre' })
  backupStatus() {
    return this.backups.status();
  }

  @Post('backups')
  @RequirePrivilege({ action: 'manage', resourceType: 'sre' })
  @Audited({ action: 'backup.register', resourceType: 'backup_run' })
  register(@Body() dto: RegisterBackupDto, @CurrentContext() ctx?: RequestContext) {
    return this.backups.register({
      kind: dto.kind,
      ...(dto.rpoTargetMinutes !== undefined ? { rpoTargetMinutes: dto.rpoTargetMinutes } : {}),
      ...(dto.rtoTargetSeconds !== undefined ? { rtoTargetSeconds: dto.rtoTargetSeconds } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('backups/:id/complete')
  @RequirePrivilege({ action: 'manage', resourceType: 'sre' })
  @Audited({ action: 'backup.complete', resourceType: 'backup_run' })
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteBackupDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.backups.complete(id, {
      status: dto.status,
      evidence: dto.evidence,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }
}
