import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Assignment,
  AssignmentKind,
  AssignmentStatus,
  RosterRepository,
  Shift,
  ShiftKind,
  ShiftStatus,
  Staff,
  StaffRole,
} from '../domain/roster.repository.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toStaff(r: {
  id: string;
  facility_id: string;
  display_name: string;
  role: string;
  contact: string;
  active: boolean;
}): Staff {
  return {
    id: r.id,
    facilityId: r.facility_id,
    displayName: r.display_name,
    role: r.role as StaffRole,
    contact: r.contact,
    active: r.active,
  };
}

function toShift(r: {
  id: string;
  staff_id: string;
  facility_id: string;
  kind: string;
  unit: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
}): Shift {
  return {
    id: r.id,
    staffId: r.staff_id,
    facilityId: r.facility_id,
    kind: r.kind as ShiftKind,
    ...(r.unit ? { unit: r.unit } : {}),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    status: r.status as ShiftStatus,
  };
}

function toAssignment(r: {
  id: string;
  staff_id: string;
  facility_id: string;
  kind: string;
  unit: string;
  starts_at: Date;
  ends_at: Date | null;
  status: string;
}): Assignment {
  return {
    id: r.id,
    staffId: r.staff_id,
    facilityId: r.facility_id,
    kind: r.kind as AssignmentKind,
    unit: r.unit,
    startsAt: iso(r.starts_at),
    ...(r.ends_at ? { endsAt: iso(r.ends_at) } : {}),
    status: r.status as AssignmentStatus,
  };
}

@Injectable()
export class KyselyRosterRepository implements RosterRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createStaff(input: {
    facilityId: string;
    displayName: string;
    role: StaffRole;
    contact: string;
  }): Promise<Staff> {
    const r = await this.db
      .insertInto('ros.staff')
      .values({
        facility_id: input.facilityId,
        display_name: input.displayName,
        role: input.role,
        contact: input.contact,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toStaff(r);
  }

  async getStaff(id: string): Promise<Staff | undefined> {
    const r = await this.db.selectFrom('ros.staff').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toStaff(r) : undefined;
  }

  async listStaff(filter: { facilityId?: string; active?: boolean }): Promise<Staff[]> {
    let q = this.db.selectFrom('ros.staff').selectAll().orderBy('display_name');
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.active !== undefined) q = q.where('active', '=', filter.active);
    const rows = await q.execute();
    return rows.map(toStaff);
  }

  async createShift(input: {
    staffId: string;
    facilityId: string;
    kind: ShiftKind;
    unit?: string;
    startsAt: string;
    endsAt: string;
  }): Promise<Shift> {
    const r = await this.db
      .insertInto('ros.shift')
      .values({
        staff_id: input.staffId,
        facility_id: input.facilityId,
        kind: input.kind,
        unit: input.unit ?? null,
        starts_at: new Date(input.startsAt),
        ends_at: new Date(input.endsAt),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toShift(r);
  }

  async getShift(id: string): Promise<Shift | undefined> {
    const r = await this.db.selectFrom('ros.shift').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toShift(r) : undefined;
  }

  async listShifts(filter: {
    staffId?: string;
    facilityId?: string;
    status?: ShiftStatus;
    kind?: ShiftKind;
    from?: Date;
    to?: Date;
  }): Promise<Shift[]> {
    let q = this.db.selectFrom('ros.shift').selectAll().orderBy('starts_at');
    if (filter.staffId) q = q.where('staff_id', '=', filter.staffId);
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.kind) q = q.where('kind', '=', filter.kind);
    if (filter.from) q = q.where('starts_at', '>=', filter.from);
    if (filter.to) q = q.where('starts_at', '<', filter.to);
    const rows = await q.execute();
    return rows.map(toShift);
  }

  async listShiftsInRange(staffId: string, from: Date, to: Date): Promise<Shift[]> {
    const rows = await this.db
      .selectFrom('ros.shift')
      .selectAll()
      .where('staff_id', '=', staffId)
      .where('status', '=', 'scheduled')
      .where('starts_at', '<', to)
      .where('ends_at', '>', from)
      .orderBy('starts_at')
      .execute();
    return rows.map(toShift);
  }

  async updateShift(id: string, input: { status: ShiftStatus }): Promise<void> {
    await this.db.updateTable('ros.shift').set({ status: input.status }).where('id', '=', id).execute();
  }

  async createAssignment(input: {
    staffId: string;
    facilityId: string;
    kind: AssignmentKind;
    unit: string;
    startsAt: string;
  }): Promise<Assignment> {
    const r = await this.db
      .insertInto('ros.assignment')
      .values({
        staff_id: input.staffId,
        facility_id: input.facilityId,
        kind: input.kind,
        unit: input.unit,
        starts_at: new Date(input.startsAt),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAssignment(r);
  }

  async getAssignment(id: string): Promise<Assignment | undefined> {
    const r = await this.db
      .selectFrom('ros.assignment')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toAssignment(r) : undefined;
  }

  async listAssignments(filter: {
    staffId?: string;
    facilityId?: string;
    unit?: string;
    status?: AssignmentStatus;
  }): Promise<Assignment[]> {
    let q = this.db.selectFrom('ros.assignment').selectAll().orderBy('starts_at');
    if (filter.staffId) q = q.where('staff_id', '=', filter.staffId);
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.unit) q = q.where('unit', '=', filter.unit);
    if (filter.status) q = q.where('status', '=', filter.status);
    const rows = await q.execute();
    return rows.map(toAssignment);
  }

  async endAssignment(id: string, endsAt: Date): Promise<void> {
    await this.db
      .updateTable('ros.assignment')
      .set({ status: 'ended', ends_at: endsAt })
      .where('id', '=', id)
      .execute();
  }
}
