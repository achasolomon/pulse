import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Asset,
  AssetStatus,
  EquipmentRepository,
  MaintenanceKind,
  MaintenanceStatus,
  MaintenanceTask,
} from '../domain/equipment.repository.js';

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toAsset(r: {
  id: string;
  facility_id: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  purchase_order_id: string | null;
  status: string;
  commissioned_at: Date;
  out_of_service_reason: string | null;
  out_of_service_since: Date | null;
  retired_at: Date | null;
}): Asset {
  return {
    id: r.id,
    facilityId: r.facility_id,
    name: r.name,
    manufacturer: r.manufacturer,
    model: r.model,
    serial: r.serial,
    ...(r.purchase_order_id ? { purchaseOrderId: r.purchase_order_id } : {}),
    status: r.status as AssetStatus,
    commissionedAt: iso(r.commissioned_at),
    ...(r.out_of_service_reason ? { outOfServiceReason: r.out_of_service_reason } : {}),
    ...(r.out_of_service_since ? { outOfServiceSince: iso(r.out_of_service_since) } : {}),
    ...(r.retired_at ? { retiredAt: iso(r.retired_at) } : {}),
  };
}

function toTask(r: {
  id: string;
  asset_id: string;
  kind: string;
  due_at: Date;
  status: string;
  interval_days: number | null;
  completed_at: Date | null;
  completed_note: string | null;
}): MaintenanceTask {
  return {
    id: r.id,
    assetId: r.asset_id,
    kind: r.kind as MaintenanceKind,
    dueAt: iso(r.due_at),
    status: r.status as MaintenanceStatus,
    ...(r.interval_days !== null ? { intervalDays: r.interval_days } : {}),
    ...(r.completed_at ? { completedAt: iso(r.completed_at) } : {}),
    ...(r.completed_note ? { completedNote: r.completed_note } : {}),
  };
}

@Injectable()
export class KyselyEquipmentRepository implements EquipmentRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createAsset(input: {
    facilityId: string;
    name: string;
    manufacturer: string;
    model: string;
    serial: string;
    purchaseOrderId?: string;
  }): Promise<Asset> {
    const r = await this.db
      .insertInto('eqp.asset')
      .values({
        facility_id: input.facilityId,
        name: input.name,
        manufacturer: input.manufacturer,
        model: input.model,
        serial: input.serial,
        purchase_order_id: input.purchaseOrderId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAsset(r);
  }

  async findAssetBySerial(serial: string): Promise<Asset | undefined> {
    const r = await this.db
      .selectFrom('eqp.asset')
      .selectAll()
      .where('serial', '=', serial)
      .executeTakeFirst();
    return r ? toAsset(r) : undefined;
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    const r = await this.db
      .selectFrom('eqp.asset')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toAsset(r) : undefined;
  }

  async listAssets(filter: { facilityId?: string; status?: AssetStatus }): Promise<Asset[]> {
    let q = this.db.selectFrom('eqp.asset').selectAll().orderBy('created_at');
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.status) q = q.where('status', '=', filter.status);
    const rows = await q.execute();
    return rows.map(toAsset);
  }

  async updateAsset(
    id: string,
    input: {
      status?: AssetStatus;
      outOfServiceReason?: string | null;
      outOfServiceSince?: Date | null;
      retiredAt?: Date;
    },
  ): Promise<void> {
    await this.db
      .updateTable('eqp.asset')
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.outOfServiceReason !== undefined
          ? { out_of_service_reason: input.outOfServiceReason }
          : {}),
        ...(input.outOfServiceSince !== undefined
          ? { out_of_service_since: input.outOfServiceSince }
          : {}),
        ...(input.retiredAt !== undefined ? { retired_at: input.retiredAt } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async createTask(input: {
    assetId: string;
    kind: MaintenanceKind;
    dueAt: string;
    intervalDays?: number;
  }): Promise<MaintenanceTask> {
    const r = await this.db
      .insertInto('eqp.maintenance_task')
      .values({
        asset_id: input.assetId,
        kind: input.kind,
        due_at: new Date(input.dueAt),
        ...(input.intervalDays !== undefined ? { interval_days: input.intervalDays } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toTask(r);
  }

  async getTask(id: string): Promise<MaintenanceTask | undefined> {
    const r = await this.db
      .selectFrom('eqp.maintenance_task')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toTask(r) : undefined;
  }

  async listTasks(filter: { assetId?: string; status?: MaintenanceStatus }): Promise<MaintenanceTask[]> {
    let q = this.db.selectFrom('eqp.maintenance_task').selectAll().orderBy('due_at');
    if (filter.assetId) q = q.where('asset_id', '=', filter.assetId);
    if (filter.status) q = q.where('status', '=', filter.status);
    const rows = await q.execute();
    return rows.map(toTask);
  }

  async updateTask(
    id: string,
    input: { status?: MaintenanceStatus; completedAt?: Date; completedNote?: string },
  ): Promise<void> {
    await this.db
      .updateTable('eqp.maintenance_task')
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.completedAt !== undefined ? { completed_at: input.completedAt } : {}),
        ...(input.completedNote !== undefined ? { completed_note: input.completedNote } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async cancelOpenTasks(assetId: string): Promise<number> {
    const r = await this.db
      .updateTable('eqp.maintenance_task')
      .set({ status: 'cancelled' })
      .where('asset_id', '=', assetId)
      .where('status', '=', 'scheduled')
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0n);
  }
}
