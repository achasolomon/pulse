import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { WorkflowService } from '../application/workflow.service.js';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepository,
} from '../domain/workflow.repository.js';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  kind!: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsString()
  facilityId!: string;
}

export class NotifyDto {
  @IsIn(['in-app', 'sms', 'email'])
  channel!: 'in-app' | 'sms' | 'email';

  @IsString()
  recipient!: string;

  @IsString()
  body!: string;
}

/** Workflow endpoints (EPIC-15 F15.1/F15.2). */
@Controller('workflow')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    @Inject(WORKFLOW_REPOSITORY) private readonly repo: WorkflowRepository,
  ) {}

  @Post('tasks')
  @RequirePrivilege({ action: 'create', resourceType: 'task' })
  @Audited({ action: 'task.create', resourceType: 'task' })
  createTask(@Body() dto: CreateTaskDto, @CurrentContext() ctx?: RequestContext) {
    return this.workflow.createTask({
      kind: dto.kind,
      ...(dto.patientId ? { patientId: dto.patientId } : {}),
      facilityId: dto.facilityId,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('tasks')
  @RequirePrivilege({ action: 'read', resourceType: 'task' })
  openTasks(@Query('facilityId') facilityId: string) {
    return this.repo.openTasks(facilityId, 50);
  }

  @Post('tasks/:id/complete')
  @RequirePrivilege({ action: 'complete', resourceType: 'task' })
  @Audited({ action: 'task.complete', resourceType: 'task' })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.workflow.transition(id, 'complete', { correlationId: ctx?.correlationId });
  }

  @Post('tasks/:id/escalate')
  @RequirePrivilege({ action: 'escalate', resourceType: 'task' })
  @Audited({ action: 'task.escalate', resourceType: 'task' })
  escalate(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.workflow.transition(id, 'escalate', { correlationId: ctx?.correlationId });
  }

  @Post('notify')
  @RequirePrivilege({ action: 'send', resourceType: 'notification' })
  @Audited({ action: 'notification.queue', resourceType: 'notification' })
  notify(@Body() dto: NotifyDto, @CurrentContext() ctx?: RequestContext) {
    return this.workflow.notify({
      channel: dto.channel,
      recipient: dto.recipient,
      body: dto.body,
      correlationId: ctx?.correlationId,
    });
  }
}
