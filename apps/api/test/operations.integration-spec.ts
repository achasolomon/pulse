import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyInventoryRepository } from './../src/modules/inventory/infrastructure/kysely-inventory.repository.js';
import { InventoryService } from './../src/modules/inventory/application/inventory.service.js';
import { KyselyWorkflowRepository } from './../src/modules/workflow/infrastructure/kysely-workflow.repository.js';
import { WorkflowService } from './../src/modules/workflow/application/workflow.service.js';
import { KyselyDocumentRepository } from './../src/modules/documents/infrastructure/kysely-document.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('operations chain (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let inventory: InventoryService;
  let workflow: WorkflowService;
  let facilityId: string;
  let itemId: string;
  let locationId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    inventory = new InventoryService(new KyselyInventoryRepository(db), outbox);
    workflow = new WorkflowService(new KyselyWorkflowRepository(db), outbox);

    const code = `O${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Ops Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Stores', code: 'ST' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    itemId = (await inventory.defineItem({ code: `GAUZE-${Date.now()}`, name: 'Gauze', baseUnit: 'pack' })).id;
    locationId = (await inventory.createLocation({ facilityId, name: 'Main Store', code: 'MAIN' })).id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('receive -> issue -> balance -> reconcile; FEFO suggests earliest lot', async () => {
    await inventory.receive({ itemId, locationId, quantityBase: 100, lotNumber: 'LATE', expiresOn: '2027-01-01' });
    await inventory.receive({ itemId, locationId, quantityBase: 50, lotNumber: 'EARLY', expiresOn: '2026-02-01' });
    await inventory.issue({ itemId, locationId, quantityBase: 30, reason: 'ward issue for testing' });
    const repo = new KyselyInventoryRepository(db);
    expect(await repo.balance(itemId, locationId)).toBe(120);
    const first = await inventory.suggestLot(itemId);
    expect(first?.lotNumber).toBe('EARLY');
    const rec = await inventory.reconcile({ itemId, locationId, counted: 118, reason: 'cycle count correction' });
    expect(rec.adjusted).toBe(-2);
    expect(await repo.balance(itemId, locationId)).toBe(118);
  });

  it('procurement posts receipt to ledger', async () => {
    const res = await inventory.procure({
      facilityId,
      itemId,
      quantityBase: 25,
      locationId,
      supplier: 'Test Supplier',
      lotNumber: `PO-${Date.now()}`,
    });
    expect(res.requisitionId).toBeDefined();
    const repo = new KyselyInventoryRepository(db);
    expect(await repo.balance(itemId, locationId)).toBe(143);
  });

  it('task lifecycle + notification record + document metadata', async () => {
    const task = await workflow.createTask({ kind: 'review-result', facilityId });
    const done = await workflow.transition(task.id, 'complete', {});
    expect(done.status).toBe('done');
    const note = await workflow.notify({ channel: 'in-app', recipient: 'nurse-1', body: 'Bed ready' });
    expect(note.id).toBeDefined();
    const docs = new KyselyDocumentRepository(db);
    const doc = await docs.register({
      name: 'Discharge summary',
      mime: 'application/pdf',
      storageKey: 'docs/2026/summary-1.pdf',
    });
    expect(doc.id).toBeDefined();
    await expect(
      docs.register({ name: 'evil', mime: 'x', storageKey: '../escape.pdf' }),
    ).rejects.toThrow('DOCUMENT_KEY_INVALID');
  });
});
