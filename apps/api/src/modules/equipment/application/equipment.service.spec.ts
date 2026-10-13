import { EquipmentService } from './equipment.service.js';
import type {
  Asset,
  EquipmentRepository,
  MaintenanceTask,
} from '../domain/equipment.repository.js';
import type { InventoryRepository } from '../../inventory/domain/inventory.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

const FAC = '00000000-0000-4000-8000-0000000000fa';

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

function store(opts: { po?: { id: string; status: string }; serial?: string } = {}) {
  const assets = new Map<string, Asset>();
  const tasks = new Map<string, MaintenanceTask>();
  let seq = 0;
  const repo: EquipmentRepository = {
    createAsset: async (input) => {
      seq += 1;
      const asset: Asset = {
        id: `00000000-0000-4000-8000-00000000a${String(seq).padStart(3, '0')}`,
        facilityId: input.facilityId,
        name: input.name,
        manufacturer: input.manufacturer,
        model: input.model,
        serial: input.serial,
        ...(input.purchaseOrderId ? { purchaseOrderId: input.purchaseOrderId } : {}),
        status: 'in_service',
        commissionedAt: new Date().toISOString(),
      };
      assets.set(asset.id, asset);
      return asset;
    },
    findAssetBySerial: async (serial) =>
      [...assets.values()].find((a) => a.serial === serial),
    getAsset: async (id) => assets.get(id),
    listAssets: async (filter) =>
      [...assets.values()].filter(
        (a) =>
          (!filter.facilityId || a.facilityId === filter.facilityId) &&
          (!filter.status || a.status === filter.status),
      ),
    updateAsset: async (id, input) => {
      const a = assets.get(id)!;
      if (input.status !== undefined) a.status = input.status;
      if (input.outOfServiceReason !== undefined) {
        a.outOfServiceReason = input.outOfServiceReason ?? undefined;
      }
      if (input.outOfServiceSince !== undefined) {
        a.outOfServiceSince = input.outOfServiceSince
          ? input.outOfServiceSince.toISOString()
          : undefined;
      }
      if (input.retiredAt !== undefined) a.retiredAt = input.retiredAt.toISOString();
    },
    createTask: async (input) => {
      seq += 1;
      const task: MaintenanceTask = {
        id: `00000000-0000-4000-8000-00000000t${String(seq).padStart(3, '0')}`,
        assetId: input.assetId,
        kind: input.kind,
        dueAt: new Date(input.dueAt).toISOString(),
        status: 'scheduled',
        ...(input.intervalDays !== undefined ? { intervalDays: input.intervalDays } : {}),
      };
      tasks.set(task.id, task);
      return task;
    },
    getTask: async (id) => tasks.get(id),
    listTasks: async (filter) =>
      [...tasks.values()]
        .filter(
          (t) =>
            (!filter.assetId || t.assetId === filter.assetId) &&
            (!filter.status || t.status === filter.status),
        )
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    updateTask: async (id, input) => {
      const t = tasks.get(id)!;
      if (input.status !== undefined) t.status = input.status;
      if (input.completedAt !== undefined) t.completedAt = input.completedAt.toISOString();
      if (input.completedNote !== undefined) t.completedNote = input.completedNote;
    },
    cancelOpenTasks: async (assetId) => {
      let n = 0;
      for (const t of tasks.values()) {
        if (t.assetId === assetId && t.status === 'scheduled') {
          t.status = 'cancelled';
          n += 1;
        }
      }
      return n;
    },
  };
  const inventory = {
    findPurchaseOrder: async (id: string) => (opts.po && opts.po.id === id ? opts.po : undefined),
  } as unknown as InventoryRepository;
  return { repo, inventory, svc: (s?: EquipmentRepository) => new EquipmentService(s ?? repo, inventory, new OutboxService(undefined)), serial: opts.serial };
}

const commissionIn = (serial: string) => ({
  facilityId: FAC,
  name: 'Dialysis Monitor',
  manufacturer: 'Fresenius',
  model: '5008S',
  serial,
});

describe('EquipmentService (unit, fakes)', () => {
  it('commission guards serial uniqueness and PO link', async () => {
    const s = store({ po: { id: '00000000-0000-4000-8000-00000000p001', status: 'received' } });
    const asset = await s.svc().commission(commissionIn('SN-1'));
    expect(asset.status).toBe('in_service');
    expect(asset.purchaseOrderId).toBeUndefined();

    await expectCode(s.svc().commission(commissionIn('SN-1')), 'SERIAL_EXISTS', 409);
    await expectCode(
      s.svc().commission({
        ...commissionIn('SN-2'),
        purchaseOrderId: '00000000-0000-4000-8000-00000000p999',
      }),
      'PURCHASE_ORDER_NOT_FOUND',
      404,
    );

    const withPo = await s.svc().commission({
      ...commissionIn('SN-3'),
      purchaseOrderId: '00000000-0000-4000-8000-00000000p001',
    });
    expect(withPo.purchaseOrderId).toBe('00000000-0000-4000-8000-00000000p001');
  });

  it('downtime requires a reason and is reversible; retirement is terminal', async () => {
    const s = store();
    const asset = await s.svc().commission(commissionIn('SN-D'));

    await expectCode(
      s.svc().takeOutOfService(asset.id, { reason: 'oil' }),
      'DOWNTIME_REASON_REQUIRED',
      400,
    );
    const oos = await s.svc().takeOutOfService(asset.id, { reason: 'Planned service window' });
    expect(oos.status).toBe('out_of_service');
    expect(oos.outOfServiceReason).toBe('Planned service window');
    await expectCode(
      s.svc().takeOutOfService(asset.id, { reason: 'Already down here' }),
      'ASSET_STATE_INVALID',
      409,
    );

    const back = await s.svc().returnToService(asset.id);
    expect(back.status).toBe('in_service');
    expect(back.outOfServiceReason).toBeUndefined();

    const retired = await s.svc().retire(asset.id, { note: 'End of life' });
    expect(retired.status).toBe('retired');
    expect(retired.retiredAt).toBeDefined();
    await expectCode(s.svc().retire(asset.id), 'ASSET_STATE_INVALID', 409);
    await expectCode(s.svc().returnToService(asset.id), 'ASSET_STATE_INVALID', 409);
    await expectCode(
      s.svc().scheduleMaintenance(asset.id, { kind: 'preventive', dueAt: '2026-12-01T09:00:00Z' }),
      'ASSET_STATE_INVALID',
      409,
    );
    await expectCode(s.svc().getAsset('00000000-0000-4000-8000-00000000dead'), 'ASSET_NOT_FOUND', 404);
  });

  it('maintenance: recurrence on complete, overdue computed, state guards', async () => {
    const s = store();
    const asset = await s.svc().commission(commissionIn('SN-M'));

    const overdueTask = await s.svc().scheduleMaintenance(asset.id, {
      kind: 'corrective',
      dueAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const initial = await s.svc().listMaintenance({ assetId: asset.id });
    expect(initial.find((t) => t.id === overdueTask.id)?.overdue).toBe(true);

    const futureDue = new Date(Date.now() + 7 * 86_400_000);
    const task = await s.svc().scheduleMaintenance(asset.id, {
      kind: 'preventive',
      dueAt: futureDue.toISOString(),
      intervalDays: 90,
    });
    const done = await s.svc().completeMaintenance(task.id, { note: 'Water test OK' });
    expect(done.task.status).toBe('completed');
    expect(done.next).toBeDefined();
    expect(done.next!.intervalDays).toBe(90);
    expect(new Date(done.next!.dueAt).getTime()).toBe(
      futureDue.getTime() + 90 * 86_400_000,
    );
    await expectCode(s.svc().completeMaintenance(task.id), 'TASK_STATE_INVALID', 409);
    await expectCode(s.svc().cancelMaintenance(task.id), 'TASK_STATE_INVALID', 409);

    const after = await s.svc().listMaintenance({ assetId: asset.id, status: 'scheduled' });
    expect(after).toHaveLength(2);
    expect(after.find((t) => t.id === overdueTask.id)?.overdue).toBe(true);
    expect(after.find((t) => t.id === done.next!.id)?.overdue).toBe(false);

    const cancelled = await s.svc().cancelMaintenance(done.next!.id);
    expect(cancelled.status).toBe('cancelled');
    await expectCode(s.svc().completeMaintenance(done.next!.id), 'TASK_STATE_INVALID', 409);

    const completedOverdue = await s.svc().completeMaintenance(overdueTask.id, {
      note: 'Late corrective done',
    });
    expect(completedOverdue.task.status).toBe('completed');
    expect(completedOverdue.next).toBeUndefined();
  });

  it('retire cancels open maintenance tasks', async () => {
    const s = store();
    const asset = await s.svc().commission(commissionIn('SN-R'));
    await s.svc().scheduleMaintenance(asset.id, {
      kind: 'calibration',
      dueAt: '2026-07-01T09:00:00.000Z',
    });
    await s.svc().retire(asset.id);
    const tasks = await s.svc().listMaintenance({ assetId: asset.id });
    expect(tasks.every((t) => t.status === 'cancelled')).toBe(true);
  });
});
