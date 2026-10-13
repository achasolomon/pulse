/**
 * Roster / workforce domain (EPIC-25). ARCH-001 practitioner assignment and
 * roster; IAM-001 section 46 assignment context (data side); OPS-001 section 45
 * on-call rota, fatigue controls, no single-person dependency. Guardrails are
 * assistive — they refuse clearly unsafe rosters, they do not replace staffing
 * policy or emergency break-glass.
 */

export type StaffRole =
  | 'doctor'
  | 'nurse'
  | 'midwife'
  | 'pharmacist'
  | 'technician'
  | 'allied_health'
  | 'coordinator';

export type ShiftKind = 'day' | 'evening' | 'night' | 'on_call_primary' | 'on_call_secondary';
export type ShiftStatus = 'scheduled' | 'completed' | 'cancelled';
export type AssignmentKind = 'primary' | 'cross_cover' | 'on_call';
export type AssignmentStatus = 'active' | 'ended';

export interface Staff {
  id: string;
  facilityId: string;
  displayName: string;
  role: StaffRole;
  contact: string;
  active: boolean;
}

export interface Shift {
  id: string;
  staffId: string;
  facilityId: string;
  kind: ShiftKind;
  unit?: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
}

export interface Assignment {
  id: string;
  staffId: string;
  facilityId: string;
  kind: AssignmentKind;
  unit: string;
  startsAt: string;
  endsAt?: string;
  status: AssignmentStatus;
}

export const ROSTER_REPOSITORY = 'ROSTER_REPOSITORY';

export interface RosterRepository {
  createStaff(input: {
    facilityId: string;
    displayName: string;
    role: StaffRole;
    contact: string;
  }): Promise<Staff>;
  getStaff(id: string): Promise<Staff | undefined>;
  listStaff(filter: { facilityId?: string; active?: boolean }): Promise<Staff[]>;
  createShift(input: {
    staffId: string;
    facilityId: string;
    kind: ShiftKind;
    unit?: string;
    startsAt: string;
    endsAt: string;
  }): Promise<Shift>;
  getShift(id: string): Promise<Shift | undefined>;
  listShifts(filter: {
    staffId?: string;
    facilityId?: string;
    status?: ShiftStatus;
    kind?: ShiftKind;
    from?: Date;
    to?: Date;
  }): Promise<Shift[]>;
  /** Non-cancelled shifts for a staff member in [from, to) — fatigue/overlap windows. */
  listShiftsInRange(staffId: string, from: Date, to: Date): Promise<Shift[]>;
  updateShift(id: string, input: { status: ShiftStatus }): Promise<void>;
  createAssignment(input: {
    staffId: string;
    facilityId: string;
    kind: AssignmentKind;
    unit: string;
    startsAt: string;
  }): Promise<Assignment>;
  getAssignment(id: string): Promise<Assignment | undefined>;
  listAssignments(filter: {
    staffId?: string;
    facilityId?: string;
    unit?: string;
    status?: AssignmentStatus;
  }): Promise<Assignment[]>;
  endAssignment(id: string, endsAt: Date): Promise<void>;
}

/** Shift lifecycle: no reopen — cancelled and completed are terminal. */
export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  scheduled: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const MAX_SHIFT_HOURS = 16;
export const ROLLING_24H_MAX_HOURS = 16;

export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  return (table[from] ?? []).includes(to);
}

export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/** On-call now: the window contains the instant (OPS-001 primary/secondary rota). */
export function isOnCallNow(shift: Pick<Shift, 'status' | 'startsAt' | 'endsAt'>, now: Date): boolean {
  if (shift.status !== 'scheduled') return false;
  const s = new Date(shift.startsAt).getTime();
  const e = new Date(shift.endsAt).getTime();
  const t = now.getTime();
  return s <= t && t < e;
}
