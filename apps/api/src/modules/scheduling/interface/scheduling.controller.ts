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
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository.js';
import { SchedulingService } from '../application/scheduling.service.js';
import { BookAppointmentDto, RescheduleDto } from './dto.js';

/** Scheduling endpoints (EPIC-05). All tenant-scoped + audited. */
@Controller('appointments')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  @Post()
  @RequirePrivilege({ action: 'write', resourceType: 'appointment' })
  @Audited({ action: 'appointment.book', resourceType: 'appointment' })
  book(@Body() dto: BookAppointmentDto, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.book({
      patientId: dto.patientId,
      facilityId: dto.facilityId,
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      scheduledAt: dto.scheduledAt,
      reason: dto.reason ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Get('queue')
  @RequirePrivilege({ action: 'read', resourceType: 'appointment' })
  queue(@Query('facilityId') facilityId: string) {
    return this.repo.queue(facilityId, 50);
  }

  @Post(':id/check-in')
  @RequirePrivilege({ action: 'check-in', resourceType: 'appointment' })
  @Audited({ action: 'appointment.check-in', resourceType: 'appointment' })
  checkIn(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.checkIn(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/start')
  @RequirePrivilege({ action: 'start', resourceType: 'appointment' })
  @Audited({ action: 'appointment.start', resourceType: 'appointment' })
  start(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.start(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/complete')
  @RequirePrivilege({ action: 'complete', resourceType: 'appointment' })
  @Audited({ action: 'appointment.complete', resourceType: 'appointment' })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.complete(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'appointment' })
  @Audited({ action: 'appointment.cancel', resourceType: 'appointment' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.cancel(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/no-show')
  @RequirePrivilege({ action: 'no-show', resourceType: 'appointment' })
  @Audited({ action: 'appointment.no-show', resourceType: 'appointment' })
  noShow(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.scheduling.markNoShow(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/reschedule')
  @RequirePrivilege({ action: 'reschedule', resourceType: 'appointment' })
  @Audited({ action: 'appointment.reschedule', resourceType: 'appointment' })
  reschedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RescheduleDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.scheduling.reschedule(id, {
      scheduledAt: dto.scheduledAt,
      correlationId: ctx?.correlationId,
    });
  }
}
