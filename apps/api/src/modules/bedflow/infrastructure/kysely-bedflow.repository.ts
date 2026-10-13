import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Bed,
  BedAssignment,
  BedflowRepository,
  CareLevel,
  LevelOfCare,
  AssignmentStatus,
} from '../domain/bedflow.repository.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toBed(r: {
  id: string;
  unit_id: string;
  facility_id: string;
  name: string;
  code: string;
  level_of_care: string | null;
  isolation_capable: boolean;
  out_of_service: boolean;
  out_of_service_reason: string | null;
}): Bed {
  return {
    id: r.id,
    unitId: r.unit_id,
    facilityId: r.facility_id,
    name: r.name,
    code: r.code,
    ...(r.level_of_care ? { levelOfCare: r.level_of_care as CareLevel } : {}),
    isolationCapable: r.isolation_capable,
    outOfService: r.out_of_service,
    ...(r.out_of_service_reason ? { outOfServiceReason: r.out_of_service_reason } : {}),
  };
}

function toAssignment(r: {
  id: string;
  location_id: string;
  encounter_id: string;
  facility_id: string;
  status: string;
  starts_at: Date;
  ended_at: Date | null;
}): BedAssignment {
  return {
    id: r.id,
    locationId: r.location_id,
    encounterId: r.encounter_id,
    facilityId: r.facility_id,
    status: r.status as AssignmentStatus,
    startsAt: iso(r.starts_at),
    ...(r.ended_at ? { endedAt: iso(r.ended_at) } : {}),
  };
}

function toLevel(r: {
  id: string;
  encounter_id: string;
  level: string;
  reason: string;
  status: string;
  starts_at: Date;
  ended_at: Date | null;
}): LevelOfCare {
  return {
    id: r.id,
    encounterId: r.encounter_id,
    level: r.level as CareLevel,
    reason: r.reason,
    status: r.status as 'active' | 'ended',
    startsAt: iso(r.starts_at),
    ...(r.ended_at ? { endedAt: iso(r.ended_at) } : {}),
  };
}

@Injectable()
export class KyselyBedflowRepository implements BedflowRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async getLocation(id: string): Promise<Bed | undefined> {
    const r = await this.db
      .selectFrom('org.location')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toBed(r) : undefined;
  }

  async configureBed(
    id: string,
    input: { levelOfCare: CareLevel; isolationCapable: boolean },
  ): Promise<void> {
    await this.db
      .updateTable('org.location')
      .set({ level_of_care: input.levelOfCare, isolation_capable: input.isolationCapable })
      .where('id', '=', id)
      .execute();
  }

  async setOutOfService(id: string, input: { outOfService: boolean; reason?: string }): Promise<void> {
    await this.db
      .updateTable('org.location')
      .set({
        out_of_service: input.outOfService,
        out_of_service_reason: input.outOfService ? (input.reason ?? null) : null,
      })
      .where('id', '=', id)
      .execute();
  }

  async listBeds(filter: { facilityId: string; level?: CareLevel }): Promise<Bed[]> {
    let q = this.db
      .selectFrom('org.location')
      .selectAll()
      .where('facility_id', '=', filter.facilityId)
      .where('kind', '=', 'bed')
      .orderBy('code');
    if (filter.level) q = q.where('level_of_care', '=', filter.level);
    const rows = await q.execute();
    return rows.map(toBed);
  }

  async createAssignment(input: {
    locationId: string;
    encounterId: string;
    facilityId: string;
  }): Promise<BedAssignment> {
    const r = await this.db
      .insertInto('flow.bed_assignment')
      .values({
        location_id: input.locationId,
        encounter_id: input.encounterId,
        facility_id: input.facilityId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAssignment(r);
  }

  async getAssignment(id: string): Promise<BedAssignment | undefined> {
    const r = await this.db
      .selectFrom('flow.bed_assignment')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toAssignment(r) : undefined;
  }

  async getActiveAssignmentByEncounter(encounterId: string): Promise<BedAssignment | undefined> {
    const r = await this.db
      .selectFrom('flow.bed_assignment')
      .selectAll()
      .where('encounter_id', '=', encounterId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return r ? toAssignment(r) : undefined;
  }

  async getActiveAssignmentByBed(locationId: string): Promise<BedAssignment | undefined> {
    const r = await this.db
      .selectFrom('flow.bed_assignment')
      .selectAll()
      .where('location_id', '=', locationId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return r ? toAssignment(r) : undefined;
  }

  async listAssignments(filter: {
    facilityId?: string;
    encounterId?: string;
    status?: AssignmentStatus;
  }): Promise<BedAssignment[]> {
    let q = this.db.selectFrom('flow.bed_assignment').selectAll().orderBy('starts_at');
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.encounterId) q = q.where('encounter_id', '=', filter.encounterId);
    if (filter.status) q = q.where('status', '=', filter.status);
    const rows = await q.execute();
    return rows.map(toAssignment);
  }

  async endAssignment(id: string, endedAt: Date): Promise<void> {
    await this.db
      .updateTable('flow.bed_assignment')
      .set({ status: 'ended', ended_at: endedAt })
      .where('id', '=', id)
      .execute();
  }

  async getActiveLevel(encounterId: string): Promise<LevelOfCare | undefined> {
    const r = await this.db
      .selectFrom('flow.level_of_care')
      .selectAll()
      .where('encounter_id', '=', encounterId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return r ? toLevel(r) : undefined;
  }

  async listLevels(encounterId: string): Promise<LevelOfCare[]> {
    const rows = await this.db
      .selectFrom('flow.level_of_care')
      .selectAll()
      .where('encounter_id', '=', encounterId)
      .orderBy('starts_at', 'desc')
      .execute();
    return rows.map(toLevel);
  }

  async createLevel(input: {
    encounterId: string;
    level: CareLevel;
    reason: string;
  }): Promise<LevelOfCare> {
    const r = await this.db
      .insertInto('flow.level_of_care')
      .values({ encounter_id: input.encounterId, level: input.level, reason: input.reason })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toLevel(r);
  }

  async endActiveLevel(encounterId: string, endedAt: Date): Promise<void> {
    await this.db
      .updateTable('flow.level_of_care')
      .set({ status: 'ended', ended_at: endedAt })
      .where('encounter_id', '=', encounterId)
      .where('status', '=', 'active')
      .execute();
  }
}
