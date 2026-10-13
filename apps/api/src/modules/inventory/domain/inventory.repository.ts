/** Inventory domain (INV-001, EPIC-13, DB-001 sections 31-34). Ledger is append-only. */

export type StockMovement = 'receive' | 'issue' | 'transfer-in' | 'transfer-out' | 'adjust';

/** Signed quantity for a movement (receives positive, issues negative). */
export function signedQuantity(movement: StockMovement, quantityBase: number): number {
  if (movement === 'receive' || movement === 'transfer-in') return Math.abs(quantityBase);
  if (movement === 'issue' || movement === 'transfer-out') return -Math.abs(quantityBase);
  return quantityBase; // adjust carries its own sign
}

export function balanceOf(entries: { quantityBase: number }[]): number {
  return entries.reduce((sum, e) => sum + Number(e.quantityBase), 0);
}

export const INVENTORY_REPOSITORY = 'INVENTORY_REPOSITORY';

export interface InventoryRepository {
  defineItem(input: {
    code: string;
    name: string;
    baseUnit: string;
    conversions: Record<string, number>;
    requiresBatch: boolean;
    requiresExpiry: boolean;
  }): Promise<{ id: string }>;
  createLocation(input: { facilityId: string; parentId?: string; name: string; code: string }): Promise<{ id: string }>;
  ensureLot(itemId: string, lotNumber: string, expiresOn?: string): Promise<{ id: string }>;
  post(input: {
    itemId: string;
    locationId: string;
    lotId?: string;
    quantityBase: number;
    movement: StockMovement;
    reason: string;
  }): Promise<{ id: string }>;
  balance(itemId: string, locationId: string): Promise<number>;
  lotsByExpiry(itemId: string): Promise<{ id: string; lotNumber: string; expiresOn?: string }[]>;
  requisition(input: { facilityId: string; itemId: string; quantityBase: number }): Promise<{ id: string }>;
  setRequisitionStatus(id: string, status: 'ordered' | 'received' | 'cancelled'): Promise<void>;
  purchaseOrder(requisitionId: string, supplier: string): Promise<{ id: string }>;
  setPurchaseOrderStatus(id: string, status: 'received' | 'cancelled'): Promise<void>;
  /** Read-only finder for the equipment commissioning handoff (INV-001 section 40). */
  findPurchaseOrder(id: string): Promise<{ id: string; status: string } | undefined>;
}
