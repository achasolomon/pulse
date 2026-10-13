import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
} from '../../inventory/domain/inventory.repository.js';
import {
  ASSET_TRANSITIONS,
  EQUIPMENT_REPOSITORY,
  canTransition,
  isOverdue,
  type AssetStatus,
  type EquipmentRepository,
  type MaintenanceKind,
  type MaintenanceStatus,
  type MaintenanceTask,
} from '../domain/equipment.repository.js';

const REASON_MIN = 5;

/**
 * Equipment / asset service (INV-001 section 40). Commissioning keeps the PO
 * link from procurement; downtime is a reversible status with a required
 * reason; retirement is terminal and cancels open maintenance. Overdue work is
 * computed against the clock at read time, never stored.
 */
@Injectable()
export class EquipmentService {
  constructor(
    @Inject(EQUIPMENT_REPOSITORY) private readonly repo: EquipmentRepository,
    @Inject(INVENTORY_REPOSITORY) private readonly inventory: InventoryRepository,
    private readonly outbox: OutboxService,
  ) {}

  async commission(input: {
    facilityId: string;
    name: string;
    manufacturer: string;
    model: string;
    serial: string;
    purchaseOrderId?: string;
    correlationId?: string;
  }) {
    const serial = input.serial.trim();
    const existing = await this.repo.findAssetBySerial(serial);
    if (existing) {
      throw new ConflictException({
        code: 'SERIAL_EXISTS',
        message: 'An asset with this serial already exists',
      });
    }
    if (input.purchaseOrderId) {
      const po = await this.inventory.findPurchaseOrder(input.purchaseOrderId);
      if (!po) {
        throw new NotFoundException({
          code: 'PURCHASE_ORDER_NOT_FOUND',
          message: 'Unknown purchase order',
        });
      }
    }
    const asset = await this.repo.createAsset({ ...input, serial });
    await this.outbox.publish({
      aggregateType: 'equipment_asset',
      aggregateId: asset.id,
      type: 'equipment.asset_commissioned',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: {
        id: asset.id,
        facilityId: asset.facilityId,
        serial: asset.serial,
        ...(asset.purchaseOrderId ? { purchaseOrderId: asset.purchaseOrderId } : {}),
      },
    });
    return asset;
  }

  getAsset(id: string) {
    return this.requireAsset(id);
  }

  listAssets(filter: { facilityId?: string; status?: AssetStatus }) {
    return this.repo.listAssets(filter);
  }

  async takeOutOfService(id: string, input: { reason: string; correlationId?: string }) {
    const asset = await this.requireAsset(id);
    this.assertAssetTransition(asset.status, 'out_of_service');
    const reason = input.reason.trim();
    if (reason.length < REASON_MIN) {
      throw new BadRequestException({
        code: 'DOWNTIME_REASON_REQUIRED',
        message: 'Downtime requires a reason (min 5 chars)',
      });
    }
    await this.repo.updateAsset(id, {
      status: 'out_of_service',
      outOfServiceReason: reason,
      outOfServiceSince: new Date(),
    });
    await this.outbox.publish({
      aggregateType: 'equipment_asset',
      aggregateId: id,
      type: 'equipment.out_of_service',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id, reason },
    });
    return (await this.repo.getAsset(id))!;
  }

  async returnToService(id: string, input: { note?: string; correlationId?: string } = {}) {
    const asset = await this.requireAsset(id);
    this.assertAssetTransition(asset.status, 'in_service');
    await this.repo.updateAsset(id, {
      status: 'in_service',
      outOfServiceReason: null,
      outOfServiceSince: null,
    });
    await this.outbox.publish({
      aggregateType: 'equipment_asset',
      aggregateId: id,
      type: 'equipment.in_service',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id, ...(input.note ? { note: input.note } : {}) },
    });
    return (await this.repo.getAsset(id))!;
  }

  async retire(id: string, input: { note?: string; correlationId?: string } = {}) {
    const asset = await this.requireAsset(id);
    this.assertAssetTransition(asset.status, 'retired');
    await this.repo.updateAsset(id, { status: 'retired', retiredAt: new Date() });
    const cancelled = await this.repo.cancelOpenTasks(id);
    await this.outbox.publish({
      aggregateType: 'equipment_asset',
      aggregateId: id,
      type: 'equipment.retired',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id, cancelledTasks: cancelled, ...(input.note ? { note: input.note } : {}) },
    });
    return (await this.repo.getAsset(id))!;
  }

  async scheduleMaintenance(
    assetId: string,
    input: {
      kind: MaintenanceKind;
      dueAt: string;
      intervalDays?: number;
      correlationId?: string;
    },
  ) {
    const asset = await this.requireAsset(assetId);
    if (asset.status === 'retired') {
      throw new ConflictException({
        code: 'ASSET_STATE_INVALID',
        message: 'Cannot schedule maintenance on a retired asset',
      });
    }
    const task = await this.repo.createTask({
      assetId,
      kind: input.kind,
      dueAt: input.dueAt,
      ...(input.intervalDays !== undefined ? { intervalDays: input.intervalDays } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'equipment_maintenance',
      aggregateId: task.id,
      type: 'equipment.maintenance_scheduled',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id: task.id, assetId, kind: task.kind, dueAt: task.dueAt },
    });
    return task;
  }

  async listMaintenance(filter: { assetId?: string; status?: MaintenanceStatus }) {
    const tasks = await this.repo.listTasks(filter);
    const now = new Date();
    return tasks.map((t) => ({ ...t, overdue: isOverdue(t, now) }));
  }

  async completeMaintenance(
    id: string,
    input: { note?: string; correlationId?: string } = {},
  ) {
    const task = await this.requireTask(id);
    if (task.status !== 'scheduled') {
      throw new ConflictException({
        code: 'TASK_STATE_INVALID',
        message: `Cannot complete a ${task.status} task`,
      });
    }
    const completedAt = new Date();
    await this.repo.updateTask(id, {
      status: 'completed',
      completedAt,
      ...(input.note ? { completedNote: input.note } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'equipment_maintenance',
      aggregateId: id,
      type: 'equipment.maintenance_completed',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id, assetId: task.assetId, kind: task.kind },
    });

    let next: MaintenanceTask | undefined;
    if (task.intervalDays) {
      const dueAt = new Date(new Date(task.dueAt).getTime() + task.intervalDays * 86_400_000);
      next = await this.repo.createTask({
        assetId: task.assetId,
        kind: task.kind,
        dueAt: dueAt.toISOString(),
        intervalDays: task.intervalDays,
      });
      await this.outbox.publish({
        aggregateType: 'equipment_maintenance',
        aggregateId: next.id,
        type: 'equipment.maintenance_scheduled',
        producer: 'equipment',
        correlationId: input.correlationId,
        payload: { id: next.id, assetId: task.assetId, kind: next.kind, dueAt: next.dueAt },
      });
    }
    return next ? { task: (await this.repo.getTask(id))!, next } : { task: (await this.repo.getTask(id))! };
  }

  async cancelMaintenance(id: string, input: { correlationId?: string } = {}) {
    const task = await this.requireTask(id);
    if (task.status !== 'scheduled') {
      throw new ConflictException({
        code: 'TASK_STATE_INVALID',
        message: `Cannot cancel a ${task.status} task`,
      });
    }
    await this.repo.updateTask(id, { status: 'cancelled' });
    await this.outbox.publish({
      aggregateType: 'equipment_maintenance',
      aggregateId: id,
      type: 'equipment.maintenance_cancelled',
      producer: 'equipment',
      correlationId: input.correlationId,
      payload: { id, assetId: task.assetId },
    });
    return (await this.repo.getTask(id))!;
  }

  private async requireAsset(id: string) {
    const asset = await this.repo.getAsset(id);
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Unknown asset id' });
    }
    return asset;
  }

  private async requireTask(id: string) {
    const task = await this.repo.getTask(id);
    if (!task) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Unknown maintenance task id' });
    }
    return task;
  }

  private assertAssetTransition(from: AssetStatus, to: AssetStatus) {
    if (!canTransition(ASSET_TRANSITIONS, from, to)) {
      throw new ConflictException({
        code: 'ASSET_STATE_INVALID',
        message: `Cannot move asset from ${from} to ${to}`,
      });
    }
  }
}
