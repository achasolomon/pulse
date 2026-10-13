import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  MAX_SHIFT_HOURS,
  ROLLING_24H_MAX_HOURS,
  ROSTER_REPOSITORY,
  SHIFT_TRANSITIONS,
  canTransition,
  hoursBetween,
  isOnCallNow,
  overlaps,
  type AssignmentKind,
  type AssignmentStatus,
  type RosterRepository,
  type ShiftKind,
  type ShiftStatus,
  type StaffRole,
} from '../domain/roster.repository.js';

/**
 * Roster / workforce service (ARCH-001, IAM-001 section 46, OPS-001 section 45).
 * Assistive controls: refuse overlapping or fatiguing rosters and single-person
 * on-call; they guardrail the roster, they do not replace staffing policy or
 * emergency break-glass.
 */
@Injectable()
export class RosterService {
  constructor(
    @Inject(ROSTER_REPOSITORY) private readonly repo: RosterRepository,
    private readonly outbox: OutboxService,
  ) {}

  async createStaff(input: {
    facilityId: string;
    displayName: string;
    role: StaffRole;
    contact?: string;
    correlationId?: string;
  }) {
    const staff = await this.repo.createStaff({
      facilityId: input.facilityId,
      displayName: input.displayName,
      role: input.role,
      contact: input.contact ?? '',
    });
    await this.outbox.publish({
      aggregateType: 'roster_staff',
      aggregateId: staff.id,
      type: 'roster.staff_created',
      producer: 'roster',
      correlationId: input.correlationId,
      payload: { id: staff.id, facilityId: staff.facilityId, role: staff.role },
    });
    return staff;
  }

  getStaff(id: string) {
    return this.requireStaff(id);
  }

  listStaff(filter: { facilityId?: string; active?: boolean }) {
    return this.repo.listStaff(filter);
  }

  async scheduleShift(input: {
    staffId: string;
    kind: ShiftKind;
    unit?: string;
    startsAt: string;
    endsAt: string;
    correlationId?: string;
  }) {
    const staff = await this.requireStaff(input.staffId);
    if (!staff.active) {
      throw new ConflictException({
        code: 'STAFF_INACTIVE',
        message: 'Cannot roster inactive staff',
      });
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(endsAt.getTime() > startsAt.getTime())) {
      throw new UnprocessableEntityException({
        code: 'SHIFT_TIME_INVALID',
        message: 'Shift end must be after start',
      });
    }
    const duration = hoursBetween(startsAt, endsAt);
    if (duration > MAX_SHIFT_HOURS) {
      throw new UnprocessableEntityException({
        code: 'SHIFT_TOO_LONG',
        message: `Shift cannot exceed ${MAX_SHIFT_HOURS} hours`,
      });
    }

    // Rolling 24h window ending at the new shift's start: prior hours + this
    // shift must stay within ROLLING_24H_MAX_HOURS (OPS-001 fatigue control).
    const priorFrom = new Date(startsAt.getTime() - 24 * 3_600_000);
    const window = await this.repo.listShiftsInRange(input.staffId, priorFrom, endsAt);

    if (window.some((s) => overlaps(startsAt, endsAt, new Date(s.startsAt), new Date(s.endsAt)))) {
      throw new ConflictException({
        code: 'SHIFT_OVERLAP',
        message: 'Shift overlaps an existing shift for this staff member',
      });
    }

    const priorHours = window.reduce((sum, s) => {
      const sStart = new Date(s.startsAt).getTime();
      const sEnd = new Date(s.endsAt).getTime();
      const oFrom = Math.max(priorFrom.getTime(), sStart);
      const oTo = Math.min(startsAt.getTime(), sEnd);
      return sum + (oTo > oFrom ? hoursBetween(new Date(oFrom), new Date(oTo)) : 0);
    }, 0);
    if (priorHours + duration > ROLLING_24H_MAX_HOURS) {
      throw new UnprocessableEntityException({
        code: 'FATIGUE_LIMIT',
        message: `Rostered hours within 24h cannot exceed ${ROLLING_24H_MAX_HOURS}`,
      });
    }

    if (input.kind === 'on_call_primary') {
      const secondaries = await this.repo.listShifts({
        facilityId: staff.facilityId,
        kind: 'on_call_secondary',
        status: 'scheduled',
      });
      const covered = secondaries.some((s) =>
        overlaps(startsAt, endsAt, new Date(s.startsAt), new Date(s.endsAt)),
      );
      if (!covered) {
        throw new UnprocessableEntityException({
          code: 'NO_SECONDARY_COVERAGE',
          message: 'On-call primary requires an overlapping secondary on-call shift',
        });
      }
    }

    const shift = await this.repo.createShift({
      staffId: input.staffId,
      facilityId: staff.facilityId,
      kind: input.kind,
      ...(input.unit ? { unit: input.unit } : {}),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    await this.outbox.publish({
      aggregateType: 'roster_shift',
      aggregateId: shift.id,
      type: 'roster.shift_scheduled',
      producer: 'roster',
      correlationId: input.correlationId,
      payload: { id: shift.id, staffId: shift.staffId, kind: shift.kind, startsAt: shift.startsAt },
    });
    return shift;
  }

  getShift(id: string) {
    return this.requireShift(id);
  }

  listShifts(filter: {
    staffId?: string;
    facilityId?: string;
    status?: ShiftStatus;
    kind?: ShiftKind;
    from?: Date;
    to?: Date;
  }) {
    return this.repo.listShifts(filter);
  }

  /** Point-in-time on-call roster (OPS-001): who is primary/secondary now. */
  async onCallNow(facilityId: string, at?: string) {
    const now = at ? new Date(at) : new Date();
    const kinds: ShiftKind[] = ['on_call_primary', 'on_call_secondary'];
    const shifts = await this.repo.listShifts({
      facilityId,
      status: 'scheduled',
      from: new Date(now.getTime() - 2 * 86_400_000),
      to: new Date(now.getTime() + 2 * 86_400_000),
    });
    return shifts
      .filter((s) => kinds.includes(s.kind) && isOnCallNow(s, now))
      .map((s) => ({ ...s, at: now.toISOString() }));
  }

  async transitionShift(
    id: string,
    to: ShiftStatus,
    opts: { correlationId?: string } = {},
  ) {
    const shift = await this.requireShift(id);
    if (!canTransition(SHIFT_TRANSITIONS, shift.status, to)) {
      throw new ConflictException({
        code: 'SHIFT_STATE_INVALID',
        message: `Cannot move shift from ${shift.status} to ${to}`,
      });
    }
    await this.repo.updateShift(id, { status: to });
    await this.outbox.publish({
      aggregateType: 'roster_shift',
      aggregateId: id,
      type: `roster.shift_${to}`,
      producer: 'roster',
      correlationId: opts.correlationId,
      payload: { id, staffId: shift.staffId, from: shift.status, to },
    });
    return (await this.repo.getShift(id))!;
  }

  async createAssignment(input: {
    staffId: string;
    kind: AssignmentKind;
    unit: string;
    startsAt?: string;
    correlationId?: string;
  }) {
    const staff = await this.requireStaff(input.staffId);
    if (!staff.active) {
      throw new ConflictException({
        code: 'STAFF_INACTIVE',
        message: 'Cannot assign inactive staff',
      });
    }
    const assignment = await this.repo.createAssignment({
      staffId: input.staffId,
      facilityId: staff.facilityId,
      kind: input.kind,
      unit: input.unit,
      startsAt: input.startsAt ?? new Date().toISOString(),
    });
    await this.outbox.publish({
      aggregateType: 'roster_assignment',
      aggregateId: assignment.id,
      type: 'roster.assignment_created',
      producer: 'roster',
      correlationId: input.correlationId,
      payload: { id: assignment.id, staffId: assignment.staffId, unit: assignment.unit },
    });
    return assignment;
  }

  listAssignments(filter: {
    staffId?: string;
    facilityId?: string;
    unit?: string;
    status?: AssignmentStatus;
  }) {
    return this.repo.listAssignments(filter);
  }

  async endAssignment(id: string, opts: { correlationId?: string } = {}) {
    const assignment = await this.requireAssignment(id);
    if (assignment.status !== 'active') {
      throw new ConflictException({
        code: 'ASSIGNMENT_STATE_INVALID',
        message: `Cannot end a ${assignment.status} assignment`,
      });
    }
    const endsAt = new Date();
    await this.repo.endAssignment(id, endsAt);
    await this.outbox.publish({
      aggregateType: 'roster_assignment',
      aggregateId: id,
      type: 'roster.assignment_ended',
      producer: 'roster',
      correlationId: opts.correlationId,
      payload: { id, staffId: assignment.staffId, unit: assignment.unit },
    });
    return (await this.repo.getAssignment(id))!;
  }

  private async requireStaff(id: string) {
    const staff = await this.repo.getStaff(id);
    if (!staff) {
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Unknown staff id' });
    }
    return staff;
  }

  private async requireShift(id: string) {
    const shift = await this.repo.getShift(id);
    if (!shift) {
      throw new NotFoundException({ code: 'SHIFT_NOT_FOUND', message: 'Unknown shift id' });
    }
    return shift;
  }

  private async requireAssignment(id: string) {
    const assignment = await this.repo.getAssignment(id);
    if (!assignment) {
      throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Unknown assignment id' });
    }
    return assignment;
  }
}
