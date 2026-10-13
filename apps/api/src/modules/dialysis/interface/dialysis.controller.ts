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
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { DialysisService } from '../application/dialysis.service.js';
import type { ProgramStatus } from '../domain/dialysis.repository.js';

export class CreateProgramDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  facilityId!: string;

  @IsUUID()
  protocolId!: string;

  @IsIn(['fistula', 'graft', 'catheter', 'peritoneal'])
  accessType!: 'fistula' | 'graft' | 'catheter' | 'peritoneal';

  @IsNumber()
  @Min(20)
  @Max(250)
  targetWeightKg!: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;
}

export class ScheduleSessionDto {
  @IsISO8601()
  scheduledFor!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;
}

export class CompleteSessionDto {
  @IsNumber()
  @Min(0)
  @Max(500)
  preWeightKg!: number;

  @IsNumber()
  @Min(0)
  @Max(500)
  postWeightKg!: number;

  @IsOptional()
  @IsString()
  @Length(3, 500)
  adverseEvent?: string;
}

export class ReasonDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class RescheduleSessionDto {
  @IsISO8601()
  scheduledFor!: string;
}

/**
 * Dialysis recurring care (EPIC-25, CLIN-001 section 22). Staff surface:
 * tenant context + privileges dialysis:read / dialysis:manage.
 */
@Controller('dialysis')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class DialysisController {
  constructor(private readonly dialysis: DialysisService) {}

  @Get('protocols')
  @RequirePrivilege({ action: 'read', resourceType: 'dialysis' })
  protocols(@Query('active') active?: string) {
    return this.dialysis.protocols(active !== 'false');
  }

  @Post('programs')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.program_create', resourceType: 'dialysis_program' })
  createProgram(@Body() dto: CreateProgramDto, @CurrentContext() ctx?: RequestContext) {
    return this.dialysis.createProgram({
      patientId: dto.patientId,
      facilityId: dto.facilityId,
      protocolId: dto.protocolId,
      accessType: dto.accessType,
      targetWeightKg: dto.targetWeightKg,
      ...(dto.startDate ? { startDate: dto.startDate } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('programs')
  @RequirePrivilege({ action: 'read', resourceType: 'dialysis' })
  listPrograms(
    @Query('patientId') patientId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: string,
  ) {
    return this.dialysis.listPrograms({
      ...(patientId ? { patientId } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(status === 'active' || status === 'paused' || status === 'closed'
        ? { status: status as ProgramStatus }
        : {}),
    });
  }

  @Get('programs/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'dialysis' })
  getProgram(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.dialysis.getProgram(id);
  }

  @Post('programs/:id/pause')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.program_pause', resourceType: 'dialysis_program' })
  pause(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.dialysis.setProgramStatus(
      id,
      'paused',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('programs/:id/resume')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.program_resume', resourceType: 'dialysis_program' })
  resume(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.dialysis.setProgramStatus(
      id,
      'active',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('programs/:id/close')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.program_close', resourceType: 'dialysis_program' })
  close(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.dialysis.setProgramStatus(
      id,
      'closed',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('programs/:id/sessions')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_schedule', resourceType: 'dialysis_session' })
  schedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ScheduleSessionDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.dialysis.scheduleSession(id, {
      scheduledFor: dto.scheduledFor,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('programs/:id/sessions')
  @RequirePrivilege({ action: 'read', resourceType: 'dialysis' })
  listSessions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.dialysis.listSessions(id);
  }

  @Post('sessions/:id/start')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_start', resourceType: 'dialysis_session' })
  start(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.dialysis.transitionSession(
      id,
      'in_progress',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('sessions/:id/complete')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_complete', resourceType: 'dialysis_session' })
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteSessionDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.dialysis.transitionSession(id, 'completed', {
      preWeightKg: dto.preWeightKg,
      postWeightKg: dto.postWeightKg,
      ...(dto.adverseEvent ? { adverseEvent: dto.adverseEvent } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('sessions/:id/defer')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_defer', resourceType: 'dialysis_session' })
  defer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.dialysis.transitionSession(id, 'deferred', {
      reason: dto.reason,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('sessions/:id/reschedule')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_reschedule', resourceType: 'dialysis_session' })
  reschedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RescheduleSessionDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.dialysis.transitionSession(id, 'scheduled', {
      scheduledFor: dto.scheduledFor,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Post('sessions/:id/cancel')
  @RequirePrivilege({ action: 'manage', resourceType: 'dialysis' })
  @Audited({ action: 'dialysis.session_cancel', resourceType: 'dialysis_session' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.dialysis.transitionSession(id, 'cancelled', {
      reason: dto.reason,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }
}
