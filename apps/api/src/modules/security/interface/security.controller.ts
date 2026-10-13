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
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { FindingService } from '../application/finding.service.js';
import { SiemService } from '../application/siem.service.js';
import type { FindingStatus } from '../domain/finding.repository.js';

export class IntakeFindingDto {
  @IsString()
  @Length(5, 200)
  title!: string;

  @IsIn(['info', 'low', 'medium', 'high', 'critical'])
  severity!: string;

  @IsString()
  @Length(2, 100)
  component!: string;

  @IsOptional()
  @IsString()
  vector?: string;

  @IsOptional()
  @IsString()
  evidence?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  remediation?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class ActFindingDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  owner?: string;

  @IsOptional()
  @IsString()
  remediation?: string;
}

/**
 * SIEM security telemetry + pentest finding triage (EPIC-22, SEC-001
 * sections 60/61/86). Staff surface: tenant context + privileges
 * security:read / security:manage. The SIEM feed never returns PHI —
 * details carry status/code/path only.
 */
@Controller('security')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class SecurityController {
  constructor(
    private readonly siem: SiemService,
    private readonly findings: FindingService,
  ) {}

  @Get('events')
  @RequirePrivilege({ action: 'read', resourceType: 'security' })
  events(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);
    return this.siem.feed(cursor ?? '', n, {
      ...(severity ? { severity } : {}),
      ...(category ? { category } : {}),
    });
  }

  @Get('detections')
  @RequirePrivilege({ action: 'read', resourceType: 'security' })
  detections() {
    return this.siem.detections();
  }

  @Post('findings')
  @RequirePrivilege({ action: 'manage', resourceType: 'security' })
  @Audited({ action: 'finding.intake', resourceType: 'security_finding' })
  intake(@Body() dto: IntakeFindingDto, @CurrentContext() ctx?: RequestContext) {
    return this.findings.create({
      title: dto.title,
      severity: dto.severity,
      component: dto.component,
      ...(dto.vector ? { vector: dto.vector } : {}),
      ...(dto.evidence ? { evidence: dto.evidence } : {}),
      ...(dto.owner ? { owner: dto.owner } : {}),
      ...(dto.remediation ? { remediation: dto.remediation } : {}),
      ...(dto.dueAt ? { dueAt: dto.dueAt } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('findings')
  @RequirePrivilege({ action: 'read', resourceType: 'security' })
  list(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    return this.findings.list({
      ...(status ? { status: status as FindingStatus } : {}),
      ...(severity ? { severity: severity as 'info' | 'low' | 'medium' | 'high' | 'critical' } : {}),
    });
  }

  @Get('findings/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'security' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.findings.get(id);
  }

  @Post('findings/:id/triage')
  @RequirePrivilege({ action: 'manage', resourceType: 'security' })
  @Audited({ action: 'finding.triage', resourceType: 'security_finding' })
  triage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.findings.act(id, 'triage', this.actInput(dto, ctx));
  }

  @Post('findings/:id/mitigate')
  @RequirePrivilege({ action: 'manage', resourceType: 'security' })
  @Audited({ action: 'finding.mitigate', resourceType: 'security_finding' })
  mitigate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.findings.act(id, 'mitigate', this.actInput(dto, ctx));
  }

  @Post('findings/:id/accept')
  @RequirePrivilege({ action: 'manage', resourceType: 'security' })
  @Audited({ action: 'finding.accept', resourceType: 'security_finding' })
  accept(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.findings.act(id, 'accept', this.actInput(dto, ctx));
  }

  private actInput(dto: ActFindingDto, ctx?: RequestContext) {
    return {
      ...(dto.owner ? { owner: dto.owner } : {}),
      ...(dto.remediation ? { remediation: dto.remediation } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    };
  }
}
