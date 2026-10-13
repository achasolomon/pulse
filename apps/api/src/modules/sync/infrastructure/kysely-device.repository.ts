import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Device,
  DeviceHeartbeat,
  DeviceKind,
  DeviceRepository,
  DeviceStatus,
} from '../domain/device.repository.js';

const DEVICE_COLUMNS = [
  'integration.device.id',
  'integration.device.facility_id',
  'integration.device.name',
  'integration.device.kind',
  'integration.device.status',
  'integration.device.capabilities',
  'integration.device.max_disconnected_hours',
  'integration.device.last_seen_at',
  'integration.device.enrolled_at',
  'integration.device.decommissioned_at',
  'org.facility.organization_id',
] as const;

type DeviceSelect = {
  id: string;
  facility_id: string;
  name: string;
  kind: string;
  status: string;
  capabilities: string[];
  max_disconnected_hours: number;
  last_seen_at: Date | null;
  enrolled_at: Date;
  decommissioned_at: Date | null;
  organization_id: string;
};

function toDevice(r: DeviceSelect): Device {
  return {
    id: r.id,
    organizationId: r.organization_id,
    facilityId: r.facility_id,
    name: r.name,
    kind: r.kind as DeviceKind,
    status: r.status as DeviceStatus,
    capabilities: r.capabilities,
    maxDisconnectedHours: r.max_disconnected_hours,
    ...(r.last_seen_at ? { lastSeenAt: r.last_seen_at.toISOString() } : {}),
    enrolledAt: r.enrolled_at.toISOString(),
    ...(r.decommissioned_at
      ? { decommissionedAt: r.decommissioned_at.toISOString() }
      : {}),
  };
}

@Injectable()
export class KyselyDeviceRepository implements DeviceRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  private base() {
    return this.db
      .selectFrom('integration.device')
      .innerJoin('org.facility', 'org.facility.id', 'integration.device.facility_id')
      .select(DEVICE_COLUMNS);
  }

  async create(input: {
    facilityId: string;
    name: string;
    kind: DeviceKind;
    capabilities: string[];
    maxDisconnectedHours: number;
    tokenHash: string;
  }): Promise<Device> {
    const row = await this.db
      .insertInto('integration.device')
      .values({
        facility_id: input.facilityId,
        name: input.name,
        kind: input.kind,
        capabilities: input.capabilities,
        max_disconnected_hours: input.maxDisconnectedHours,
        token_hash: input.tokenHash,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const found = await this.findById(row.id);
    if (!found) throw new Error('DEVICE_CREATE_FAILED');
    return found;
  }

  async findById(id: string): Promise<Device | undefined> {
    const r = await this.base().where('integration.device.id', '=', id).executeTakeFirst();
    return r ? toDevice(r) : undefined;
  }

  async findByTokenHash(tokenHash: string): Promise<Device | undefined> {
    const r = await this.base()
      .where('integration.device.token_hash', '=', tokenHash)
      .executeTakeFirst();
    return r ? toDevice(r) : undefined;
  }

  async list(facilityId?: string): Promise<Device[]> {
    let q = this.base().orderBy('integration.device.enrolled_at');
    if (facilityId) q = q.where('integration.device.facility_id', '=', facilityId);
    const rows = await q.execute();
    return rows.map(toDevice);
  }

  async setStatus(id: string, status: DeviceStatus, at: Date = new Date()): Promise<void> {
    await this.db
      .updateTable('integration.device')
      .set({
        status,
        ...(status === 'decommissioned' ? { decommissioned_at: at } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async recordHeartbeat(
    id: string,
    heartbeat: DeviceHeartbeat & { at: Date },
  ): Promise<void> {
    await this.db
      .insertInto('integration.device_heartbeat')
      .values({
        device_id: id,
        pending_out: heartbeat.pendingOut,
        pending_in: heartbeat.pendingIn,
        last_sync_at: heartbeat.lastSyncAt ? new Date(heartbeat.lastSyncAt) : null,
        recorded_at: heartbeat.at,
      })
      .execute();
    await this.db
      .updateTable('integration.device')
      .set({
        last_seen_at: heartbeat.at,
        last_heartbeat: {
          pendingOut: heartbeat.pendingOut,
          pendingIn: heartbeat.pendingIn,
          ...(heartbeat.lastSyncAt ? { lastSyncAt: heartbeat.lastSyncAt } : {}),
        },
      })
      .where('id', '=', id)
      .execute();
  }
}
