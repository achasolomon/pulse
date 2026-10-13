import { AuditService } from './audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { OutboxRelay } from '../outbox/outbox.relay.js';

describe('platform services without DB (fail-open)', () => {
  const OLD = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = OLD;
  });

  it('audit.record resolves without db', async () => {
    const svc = new AuditService(undefined);
    await expect(
      svc.record({ action: 'test', resourceType: 'test' }),
    ).resolves.toBeUndefined();
  });

  it('outbox.publish returns envelope without db', async () => {
    const svc = new OutboxService(undefined);
    const evt = await svc.publish({
      aggregateType: 'test',
      aggregateId: '11111111-1111-1111-1111-111111111111',
      type: 'test.happened',
      producer: 'test',
    });
    expect(evt.eventId).toBeDefined();
    expect(evt.type).toBe('test.happened');
  });

  it('relay claimBatch returns empty without db', async () => {
    const relay = new OutboxRelay(undefined);
    await expect(relay.claimBatch()).resolves.toEqual([]);
  });
});
