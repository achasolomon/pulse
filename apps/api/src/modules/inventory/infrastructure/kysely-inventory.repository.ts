import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import type {
  InventoryRepository,
  StockMovement,
} from '../domain/inventory.repository.js';

@Injectable()
export class KyselyInventoryRepository implements InventoryRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async defineItem(input: {
    code: string;
    name: string;
    baseUnit: string;
    conversions: Record<string, number>;
    requiresBatch: boolean;
    requiresExpiry: boolean;
  }) {
    const r = await this.db
      .insertInto('inv.item')
      .values({
        code: input.code,
        name: input.name,
        base_unit: input.baseUnit,
        conversions: JSON.stringify(input.conversions),
        requires_batch: input.requiresBatch,
        requires_expiry: input.requiresExpiry,
      })
      .onConflict((oc) => oc.column('code').doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (r) return { id: r.id };
    const existing = await this.db
      .selectFrom('inv.item')
      .select(['id'])
      .where('code', '=', input.code)
      .executeTakeFirstOrThrow();
    return { id: existing.id };
  }

  async createLocation(input: { facilityId: string; parentId?: string; name: string; code: string }) {
    const r = await this.db
      .insertInto('inv.location')
      .values({
        facility_id: input.facilityId,
        parent_id: input.parentId ?? null,
        name: input.name,
        code: input.code,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async ensureLot(itemId: string, lotNumber: string, expiresOn?: string) {
    const existing = await this.db
      .selectFrom('inv.lot')
      .select(['id'])
      .where('item_id', '=', itemId)
      .where('lot_number', '=', lotNumber)
      .executeTakeFirst();
    if (existing) return { id: existing.id };
    const r = await this.db
      .insertInto('inv.lot')
      .values({
        item_id: itemId,
        lot_number: lotNumber,
        expires_on: expiresOn ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async post(input: {
    itemId: string;
    locationId: string;
    lotId?: string;
    quantityBase: number;
    movement: StockMovement;
    reason: string;
  }) {
    const r = await this.db
      .insertInto('inv.ledger')
      .values({
        item_id: input.itemId,
        location_id: input.locationId,
        lot_id: input.lotId ?? null,
        quantity_base: input.quantityBase,
        movement: input.movement,
        reason: input.reason,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async balance(itemId: string, locationId: string): Promise<number> {
    const r = await this.db
      .selectFrom('inv.ledger')
      .select((eb) => eb.fn.sum<number>('quantity_base').as('total'))
      .where('item_id', '=', itemId)
      .where('location_id', '=', locationId)
      .executeTakeFirst();
    return Number(r?.total ?? 0);
  }

  async lotsByExpiry(itemId: string) {
    const rows = await this.db
      .selectFrom('inv.lot')
      .select(['id', 'lot_number', 'expires_on'])
      .where('item_id', '=', itemId)
      .orderBy('expires_on', 'asc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      lotNumber: r.lot_number,
      ...(r.expires_on ? { expiresOn: toDateOnly(r.expires_on) } : {}),
    }));
  }

  async requisition(input: { facilityId: string; itemId: string; quantityBase: number }) {
    const r = await this.db
      .insertInto('inv.requisition')
      .values({
        facility_id: input.facilityId,
        item_id: input.itemId,
        quantity_base: input.quantityBase,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async setRequisitionStatus(id: string, status: 'ordered' | 'received' | 'cancelled'): Promise<void> {
    await this.db
      .updateTable('inv.requisition')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  async purchaseOrder(requisitionId: string, supplier: string) {
    const r = await this.db
      .insertInto('inv.purchase_order')
      .values({ requisition_id: requisitionId, supplier })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async setPurchaseOrderStatus(id: string, status: 'received' | 'cancelled'): Promise<void> {
    await this.db
      .updateTable('inv.purchase_order')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }

  async findPurchaseOrder(id: string): Promise<{ id: string; status: string } | undefined> {
    return this.db
      .selectFrom('inv.purchase_order')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
