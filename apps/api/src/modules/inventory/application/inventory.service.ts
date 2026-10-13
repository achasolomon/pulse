import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  INVENTORY_REPOSITORY,
  signedQuantity,
  type InventoryRepository,
} from '../domain/inventory.repository.js';

/** Inventory application service (EPIC-13 F13.1–F13.5). Ledger append-only; issues balance-guarded. */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly repo: InventoryRepository,
    private readonly outbox: OutboxService,
  ) {}

  defineItem(input: {
    code: string;
    name: string;
    baseUnit: string;
    conversions?: Record<string, number>;
    requiresBatch?: boolean;
    requiresExpiry?: boolean;
  }) {
    return this.repo.defineItem({
      ...input,
      conversions: input.conversions ?? {},
      requiresBatch: input.requiresBatch ?? false,
      requiresExpiry: input.requiresExpiry ?? false,
    });
  }

  createLocation(input: { facilityId: string; parentId?: string; name: string; code: string }) {
    return this.repo.createLocation(input);
  }

  async receive(input: {
    itemId: string;
    locationId: string;
    quantityBase: number;
    lotNumber?: string;
    expiresOn?: string;
    correlationId?: string;
  }) {
    if (input.quantityBase <= 0) {
      throw new BadRequestException({ code: 'QTY_POSITIVE', message: 'Receive quantity must be positive' });
    }
    let lotId: string | undefined;
    if (input.lotNumber) {
      lotId = (await this.repo.ensureLot(input.itemId, input.lotNumber, input.expiresOn)).id;
    }
    const row = await this.repo.post({
      itemId: input.itemId,
      locationId: input.locationId,
      ...(lotId ? { lotId } : {}),
      quantityBase: signedQuantity('receive', input.quantityBase),
      movement: 'receive',
      reason: 'goods-receipt',
    });
    await this.outbox.publish({
      aggregateType: 'stock',
      aggregateId: input.itemId,
      type: 'stock.received',
      producer: 'inventory',
      correlationId: input.correlationId,
      payload: { itemId: input.itemId, locationId: input.locationId },
    });
    return row;
  }

  async issue(input: {
    itemId: string;
    locationId: string;
    quantityBase: number;
    reason: string;
    correlationId?: string;
  }) {
    if (input.quantityBase <= 0) {
      throw new BadRequestException({ code: 'QTY_POSITIVE', message: 'Issue quantity must be positive' });
    }
    const balance = await this.repo.balance(input.itemId, input.locationId);
    if (balance < input.quantityBase) {
      throw new UnprocessableEntityException({
        code: 'INSUFFICIENT_STOCK',
        message: `Balance ${balance} below issue ${input.quantityBase}`,
      });
    }
    const row = await this.repo.post({
      itemId: input.itemId,
      locationId: input.locationId,
      quantityBase: signedQuantity('issue', input.quantityBase),
      movement: 'issue',
      reason: input.reason,
    });
    await this.outbox.publish({
      aggregateType: 'stock',
      aggregateId: input.itemId,
      type: 'stock.issued',
      producer: 'inventory',
      correlationId: input.correlationId,
      payload: { itemId: input.itemId, locationId: input.locationId },
    });
    return row;
  }

  /** Stock count reconciliation: posts a signed adjustment with reason; history kept. */
  async reconcile(input: {
    itemId: string;
    locationId: string;
    counted: number;
    reason: string;
    correlationId?: string;
  }) {
    const balance = await this.repo.balance(input.itemId, input.locationId);
    const delta = input.counted - balance;
    if (delta === 0) return { adjusted: 0 };
    await this.repo.post({
      itemId: input.itemId,
      locationId: input.locationId,
      quantityBase: delta,
      movement: 'adjust',
      reason: input.reason,
    });
    await this.outbox.publish({
      aggregateType: 'stock',
      aggregateId: input.itemId,
      type: 'stock.reconciled',
      producer: 'inventory',
      correlationId: input.correlationId,
      payload: { itemId: input.itemId, delta },
    });
    return { adjusted: delta };
  }

  /** Procurement: requisition -> PO -> receipt posts ledger receive. */
  async procure(input: {
    facilityId: string;
    itemId: string;
    quantityBase: number;
    locationId: string;
    supplier: string;
    lotNumber?: string;
    correlationId?: string;
  }) {
    const req = await this.repo.requisition({
      facilityId: input.facilityId,
      itemId: input.itemId,
      quantityBase: input.quantityBase,
    });
    await this.repo.setRequisitionStatus(req.id, 'ordered');
    const po = await this.repo.purchaseOrder(req.id, input.supplier);
    await this.receive({
      itemId: input.itemId,
      locationId: input.locationId,
      quantityBase: input.quantityBase,
      ...(input.lotNumber ? { lotNumber: input.lotNumber } : {}),
      correlationId: input.correlationId,
    });
    await this.repo.setRequisitionStatus(req.id, 'received');
    await this.repo.setPurchaseOrderStatus(po.id, 'received');
    return { requisitionId: req.id, purchaseOrderId: po.id };
  }

  /** FEFO hint: earliest-expiry lot first. */
  suggestLot(itemId: string) {
    return this.repo.lotsByExpiry(itemId).then((lots) => lots[0]);
  }
}
