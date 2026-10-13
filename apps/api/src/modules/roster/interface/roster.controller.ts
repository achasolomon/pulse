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
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { RosterService } from '../application/roster.service.js';
import type {
  AssignmentKind,
  AssignmentStatus,
  ShiftKind,
  ShiftStatus,
  StaffRole,
} from '../domain/roster.repository.js';

export class CreateStaffDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsIn(['doctor', 'nurse', 'midwife', 'pharmacist', 'technician', 'allied_health', 'coordinator'])
  role!: StaffRole;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  contact?: string;
}

export class ScheduleShiftDto {
  @IsUUID()
  staffId!: string;

  @IsIn(['day', 'evening', 'night', 'on_call_primary', 'on_call_secondary'])
  kind!: ShiftKind;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  unit?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}

export class CreateAssignmentDto {
  @IsUUID()
  staffId!: string;

  @IsIn(['primary', 'cross_cover', 'on_call'])
  kind!: AssignmentKind;

  @IsString()
  @Length(1, 60)
  unit!: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;
}

/**
 * Roster / workforce (EPIC-25, ARCH-001 + IAM-001 section 46 + OPS-001 section 45).
 * Staff surface: tenant context + privileges roster:read / roster:manage.
 */
@Controller('roster')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Post('staff')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.staff_create', resourceType: 'roster_staff' })
  createStaff(@Body() dto: CreateStaffDto, @CurrentContext() ctx?: RequestContext) {
    return this.roster.createStaff({
      facilityId: dto.facilityId,
      displayName: dto.displayName,
      role: dto.role,
      ...(dto.contact !== undefined ? { contact: dto.contact } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('staff')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  listStaff(@Query('facilityId') facilityId?: string, @Query('active') active?: string) {
    return this.roster.listStaff({
      ...(facilityId ? { facilityId } : {}),
      ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
    });
  }

  @Get('staff/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  getStaff(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.roster.getStaff(id);
  }

  @Post('shifts')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.shift_schedule', resourceType: 'roster_shift' })
  schedule(@Body() dto: ScheduleShiftDto, @CurrentContext() ctx?: RequestContext) {
    return this.roster.scheduleShift({
      staffId: dto.staffId,
      kind: dto.kind,
      ...(dto.unit ? { unit: dto.unit } : {}),
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('shifts')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  listShifts(
    @Query('staffId') staffId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    const kinds: ShiftKind[] = ['day', 'evening', 'night', 'on_call_primary', 'on_call_secondary'];
    return this.roster.listShifts({
      ...(staffId ? { staffId } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(status === 'scheduled' || status === 'completed' || status === 'cancelled'
        ? { status: status as ShiftStatus }
        : {}),
      ...(kind && kinds.includes(kind as ShiftKind) ? { kind: kind as ShiftKind } : {}),
    });
  }

  @Get('shifts/current')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  current(
    @Query('facilityId') facilityId?: string,
    @Query('staffId') staffId?: string,
  ) {
    const now = new Date();
    return this.roster.listShifts({
      status: 'scheduled',
      ...(facilityId ? { facilityId } : {}),
      ...(staffId ? { staffId } : {}),
      from: new Date(now.getTime() - 86_400_000),
      to: new Date(now.getTime() + 86_400_000),
    });
  }

  @Get('on-call')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  onCall(@Query('facilityId') facilityId: string, @Query('at') at?: string) {
    return this.roster.onCallNow(facilityId, at);
  }

  @Post('shifts/:id/complete')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.shift_complete', resourceType: 'roster_shift' })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.roster.transitionShift(
      id,
      'completed',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('shifts/:id/cancel')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.shift_cancel', resourceType: 'roster_shift' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.roster.transitionShift(
      id,
      'cancelled',
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }

  @Post('assignments')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.assignment_create', resourceType: 'roster_assignment' })
  createAssignment(@Body() dto: CreateAssignmentDto, @CurrentContext() ctx?: RequestContext) {
    return this.roster.createAssignment({
      staffId: dto.staffId,
      kind: dto.kind,
      unit: dto.unit,
      ...(dto.startsAt ? { startsAt: dto.startsAt } : {}),
      ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
    });
  }

  @Get('assignments')
  @RequirePrivilege({ action: 'read', resourceType: 'roster' })
  listAssignments(
    @Query('staffId') staffId?: string,
    @Query('facilityId') facilityId?: string,
    @Query('unit') unit?: string,
    @Query('status') status?: string,
  ) {
    return this.roster.listAssignments({
      ...(staffId ? { staffId } : {}),
      ...(facilityId ? { facilityId } : {}),
      ...(unit ? { unit } : {}),
      ...(status === 'active' || status === 'ended' ? { status: status as AssignmentStatus } : {}),
    });
  }

  @Post('assignments/:id/end')
  @RequirePrivilege({ action: 'manage', resourceType: 'roster' })
  @Audited({ action: 'roster.assignment_end', resourceType: 'roster_assignment' })
  endAssignment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.roster.endAssignment(
      id,
      ctx?.correlationId ? { correlationId: ctx.correlationId } : {},
    );
  }
}
