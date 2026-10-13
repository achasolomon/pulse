import { InventoryService } from './inventory.service.js';
import { balanceOf, signedQuantity } from '../domain/inventory.repository.js';
import type { InventoryRepository } from '../domain/inventory.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('ledger math (pure)', () => {
  it('signs movements and balances', () => {
    expect(signedQuantity('receive', 10)).toBe(10);
    expect(signedQuantity('issue', 10)).toBe(-10);
    expect(signedQuantity('transfer-in', 5)).toBe(5);
    expect(signedQuantity('transfer-out', 5)).toBe(-5);
    expect(signedQuantity('adjust', -3)).toBe(-3);
    expect(balanceOf([{ quantityBase: 10 }, { quantityBase: -4 }])).toBe(6);
  });
});

describe('InventoryService (unit, fake repo)', () => {
  function fake(balance: number): InventoryRepository {
    return {
      defineItem: async () => ({ id: 'i1' }),
      createLocation: async () => ({ id: 'l1' }),
      ensureLot: async () => ({ id: 'lot1' }),
      post: async () => ({ id: 'm1' }),
      balance: async () => balance,
      lotsByExpiry: async () => [],
      requisition: async () => ({ id: 'r1' }),
      setRequisitionStatus: async () => undefined,
      purchaseOrder: async () => ({ id: 'p1' }),
      setPurchaseOrderStatus: async () => undefined,
      findPurchaseOrder: async () => undefined,
    };
  }

  it('refuses to issue more than balance (422)', async () => {
    const svc = new InventoryService(fake(5), new OutboxService(undefined));
    const err = await svc
      .issue({ itemId: 'i', locationId: 'l', quantityBase: 10, reason: 'ward issue for testing' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(422);
  });

  it('reconcile posts signed delta', async () => {
    const posted: number[] = [];
    const repo = fake(8);
    repo.post = async (input) => {
      posted.push(input.quantityBase);
      return { id: 'm1' };
    };
    const svc = new InventoryService(repo, new OutboxService(undefined));
    const res = await svc.reconcile({
      itemId: 'i',
      locationId: 'l',
      counted: 10,
      reason: 'cycle count correction',
    });
    expect(res).toEqual({ adjusted: 2 });
    expect(posted).toEqual([2]);
  });

  it('no-ops reconcile when counted equals balance', async () => {
    const svc = new InventoryService(fake(10), new OutboxService(undefined));
    await expect(
      svc.reconcile({ itemId: 'i', locationId: 'l', counted: 10, reason: 'cycle count ok' }),
    ).resolves.toEqual({ adjusted: 0 });
  });
});
