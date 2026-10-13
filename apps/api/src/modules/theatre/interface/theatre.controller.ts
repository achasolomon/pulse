import {
  Body,
  Controller,
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
import { TheatreService } from '../application/theatre.service.js';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class DefineSuiteDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  name!: string;

  @IsString()
  code!: string;
}

export class BookCaseDto {
  @IsUUID()
  encounterId!: string;

  @IsUUID()
  suiteId!: string;

  @IsString()
  @Length(2, 300)
  procedureName!: string;

  @IsOptional()
  @IsIn(['elective', 'urgent', 'emergency'])
  urgency?: string;

  @IsString()
  scheduledAt!: string;
}

export class ChecklistDto {
  @IsIn(['sign-in', 'time-out', 'sign-out'])
  stage!: 'sign-in' | 'time-out' | 'sign-out';

  @IsOptional()
  items?: unknown[];

  @IsOptional()
  @IsUUID()
  completedBy?: string;
}

export class RecordDto {
  @IsOptional()
  @IsString()
  surgeon?: string;

  @IsOptional()
  @IsString()
  anesthetist?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  startedAt?: string;

  @IsOptional()
  @IsString()
  endedAt?: string;
}

export class CancelCaseDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** Theatre endpoints (R6 slice). */
@Controller('theatre')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class TheatreController {
  constructor(private readonly theatre: TheatreService) {}

  @Post('suites')
  @RequirePrivilege({ action: 'manage', resourceType: 'theatre' })
  @Audited({ action: 'theatre.suite_define', resourceType: 'theatre_suite' })
  defineSuite(@Body() dto: DefineSuiteDto) {
    return this.theatre.defineSuite(dto.facilityId, dto.name, dto.code);
  }

  @Post('bookings')
  @RequirePrivilege({ action: 'book', resourceType: 'theatre' })
  @Audited({ action: 'theatre.book', resourceType: 'theatre_booking' })
  book(@Body() dto: BookCaseDto, @CurrentContext() ctx?: RequestContext) {
    return this.theatre.book({
      encounterId: dto.encounterId,
      suiteId: dto.suiteId,
      procedureName: dto.procedureName,
      urgency: dto.urgency ?? 'elective',
      scheduledAt: dto.scheduledAt,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('bookings/:id/check-in')
  @RequirePrivilege({ action: 'check-in', resourceType: 'theatre' })
  @Audited({ action: 'theatre.check_in', resourceType: 'theatre_booking' })
  checkIn(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.theatre.checkIn(id, { correlationId: ctx?.correlationId });
  }

  @Post('bookings/:id/start')
  @RequirePrivilege({ action: 'start', resourceType: 'theatre' })
  @Audited({ action: 'theatre.start', resourceType: 'theatre_booking' })
  start(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.theatre.start(id, { correlationId: ctx?.correlationId });
  }

  @Post('bookings/:id/checklist')
  @RequirePrivilege({ action: 'checklist', resourceType: 'theatre' })
  @Audited({ action: 'theatre.checklist', resourceType: 'theatre_booking' })
  checklist(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChecklistDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.theatre.checklist(id, dto.stage, dto.items ?? [], {
      ...(dto.completedBy ? { completedBy: dto.completedBy } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('bookings/:id/record')
  @RequirePrivilege({ action: 'record', resourceType: 'theatre' })
  @Audited({ action: 'theatre.record', resourceType: 'theatre_booking' })
  record(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RecordDto) {
    return this.theatre.record(id, {
      surgeon: dto.surgeon ?? '',
      anesthetist: dto.anesthetist ?? '',
      notes: dto.notes ?? '',
      ...(dto.startedAt ? { startedAt: dto.startedAt } : {}),
      ...(dto.endedAt ? { endedAt: dto.endedAt } : {}),
    });
  }

  @Post('bookings/:id/complete')
  @RequirePrivilege({ action: 'complete', resourceType: 'theatre' })
  @Audited({ action: 'theatre.complete', resourceType: 'theatre_booking' })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.theatre.complete(id, { correlationId: ctx?.correlationId });
  }

  @Post('bookings/:id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'theatre' })
  @Audited({ action: 'theatre.cancel', resourceType: 'theatre_booking' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelCaseDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.theatre.cancel(id, { reason: dto.reason, correlationId: ctx?.correlationId });
  }
}
