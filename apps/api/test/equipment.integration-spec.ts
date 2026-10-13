import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyEquipmentRepository } from './../src/modules/equipment/infrastructure/kysely-equipment.repository.js';
import { EquipmentService } from './../src/modules/equipment/application/equipment.service.js';
import { KyselyInventoryRepository } from './../src/modules/inventory/infrastructure/kysely-inventory.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

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

describe.skipIf(!hasDb)('equipment asset lifecycle (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let equipment: EquipmentService;
  let facilityId: string;
  let poId: string;
  const RUN = `E${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const inventory = new KyselyInventoryRepository(db);
    equipment = new EquipmentService(new KyselyEquipmentRepository(db), inventory, outbox);

    const org = await db
      .insertInto('org.organization')
      .values({ name: `Eqp Org ${RUN}`, code: RUN.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Biomedical Engineering', code: `F${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;

    const item = await db
      .insertInto('inv.item')
      .values({ code: `IT${RUN}`.slice(0, 12), name: 'Dialysis cartridge', base_unit: 'ea', conversions: '{}' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const req = await db
      .insertInto('inv.requisition')
      .values({ facility_id: facilityId, item_id: item.id, quantity_base: 1 })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const po = await db
      .insertInto('inv.purchase_order')
      .values({ requisition_id: req.id, supplier: `MedSupplier ${RUN}` })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    poId = po.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('commission links PO, guards serial + PO, downtime roundtrip, maintenance recurrence, retire', async () => {
    const serial = `SN${RUN}`;
    const asset = await equipment.commission({
      facilityId,
      name: 'Dialysis Monitor',
      manufacturer: 'Fresenius',
      model: '5008S',
      serial,
      purchaseOrderId: poId,
    });
    expect(asset.status).toBe('in_service');
    expect(asset.purchaseOrderId).toBe(poId);

    await expectCode(
      equipment.commission({
        facilityId, name: 'Dup', manufacturer: 'Fresenius', model: '5008S', serial,
      }),
      'SERIAL_EXISTS',
      409,
    );
    await expectCode(
      equipment.commission({
        facilityId, name: 'BadPO', manufacturer: 'Ge', model: 'X', serial: `SN2${RUN}`,
        purchaseOrderId: '00000000-0000-4000-8000-00000000d00e',
      }),
      'PURCHASE_ORDER_NOT_FOUND',
      404,
    );

    await expectCode(
      equipment.takeOutOfService(asset.id, { reason: 'oil' }),
      'DOWNTIME_REASON_REQUIRED',
      400,
    );
    const oos = await equipment.takeOutOfService(asset.id, { reason: 'Planned service window' });
    expect(oos.status).toBe('out_of_service');
    const back = await equipment.returnToService(asset.id);
    expect(back.status).toBe('in_service');
    expect(back.outOfServiceReason).toBeUndefined();

    const future = new Date(Date.now() + 7 * 86_400_000);
    const recurring = await equipment.scheduleMaintenance(asset.id, {
      kind: 'preventive',
      dueAt: future.toISOString(),
      intervalDays: 90,
    });
    const done = await equipment.completeMaintenance(recurring.id, { note: `Water test ${RUN}` });
    expect(done.task.status).toBe('completed');
    expect(done.next).toBeDefined();
    expect(new Date(done.next!.dueAt).getTime()).toBe(future.getTime() + 90 * 86_400_000);
    await expectCode(equipment.completeMaintenance(recurring.id), 'TASK_STATE_INVALID', 409);

    const overdueTask = await equipment.scheduleMaintenance(asset.id, {
      kind: 'corrective',
      dueAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const scheduled = await equipment.listMaintenance({ assetId: asset.id, status: 'scheduled' });
    expect(scheduled.find((t) => t.id === overdueTask.id)?.overdue).toBe(true);
    expect(scheduled.find((t) => t.id === done.next!.id)?.overdue).toBe(false);

    const retired = await equipment.retire(asset.id, { note: `End of life ${RUN}` });
    expect(retired.status).toBe('retired');
    const afterRetire = await equipment.listMaintenance({ assetId: asset.id });
    expect(afterRetire.every((t) => t.status !== 'scheduled')).toBe(true);
    await expectCode(
      equipment.scheduleMaintenance(asset.id, { kind: 'preventive', dueAt: future.toISOString() }),
      'ASSET_STATE_INVALID',
      409,
    );
    await expectCode(equipment.retire(asset.id), 'ASSET_STATE_INVALID', 409);

    const listed = await equipment.listAssets({ facilityId, status: 'retired' });
    expect(listed.map((a) => a.id)).toContain(asset.id);

    const taskIds = afterRetire.map((t) => t.id);
    const events = await db
      .selectFrom('integration.outbox')
      .select(['type', 'aggregate_id'])
      .where('aggregate_id', 'in', [asset.id, recurring.id, ...(done.next ? [done.next.id] : []), ...taskIds])
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'equipment.asset_commissioned',
        'equipment.out_of_service',
        'equipment.in_service',
        'equipment.maintenance_scheduled',
        'equipment.maintenance_completed',
        'equipment.retired',
      ]),
    );
  });

  it('guards: unknown asset/task, downtime state rules, complete before schedule-state', async () => {
    await expectCode(equipment.getAsset('00000000-0000-4000-8000-00000000d00e'), 'ASSET_NOT_FOUND', 404);
    await expectCode(
      equipment.completeMaintenance('00000000-0000-4000-8000-00000000d00f'),
      'TASK_NOT_FOUND',
      404,
    );

    const asset = await equipment.commission({
      facilityId,
      name: 'Infusion Pump',
      manufacturer: 'B. Braun',
      model: 'Infusomat',
      serial: `IP${RUN}`,
    });
    const first = await equipment.takeOutOfService(asset.id, { reason: 'Planned service window' });
    expect(first.status).toBe('out_of_service');
    await expectCode(
      equipment.takeOutOfService(asset.id, { reason: 'Second downtime reason' }),
      'ASSET_STATE_INVALID',
      409,
    );
    const back = await equipment.returnToService(asset.id);
    expect(back.status).toBe('in_service');
    await expectCode(equipment.returnToService(asset.id), 'ASSET_STATE_INVALID', 409);
  });
});
