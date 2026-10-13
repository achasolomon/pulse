import { BreakGlassService } from './break-glass.service.js';
import type { BreakGlassRepository } from '../domain/break-glass.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

const REAL = 'unconscious trauma patient, no identification';

function fakeRepo(over: Partial<BreakGlassRepository> = {}): BreakGlassRepository {
  return {
    create: async () => ({ id: 'g1', expiresAt: new Date(Date.now() + 1000) }),
    countRecent: async () => 0,
    findActive: async () => undefined,
    expireDue: async () => [],
    ...over,
  };
}

function svc(repo: BreakGlassRepository) {
  return new BreakGlassService(repo, new OutboxService(undefined));
}

describe('BreakGlassService (unit, fake repo)', () => {
  const prev = process.env.DATABASE_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  });

  it('rejects throwaway reasons before touching the repo', async () => {
    delete process.env.DATABASE_URL;
    const err = await svc(fakeRepo())
      .activate({
        personId: 'p1',
        facilityId: 'f1',
        resourceType: 'patient',
        action: 'read',
        reason: 'testtesttest',
      })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(403);
  });

  it('rejects ineligible resources', async () => {
    delete process.env.DATABASE_URL;
    const err = await svc(fakeRepo())
      .activate({
        personId: 'p1',
        facilityId: 'f1',
        resourceType: 'revenue.charge',
        action: 'create',
        reason: REAL,
      })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(403);
  });

  it('denies abusive repeat use before opening a grant', async () => {
    process.env.DATABASE_URL = 'postgresql://test-only/unit';
    const err = await svc(fakeRepo({ countRecent: async () => 5 }))
      .activate({
        personId: 'p1',
        facilityId: 'f1',
        resourceType: 'patient',
        action: 'read',
        reason: REAL,
      })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(403);
  });

  it('persists a reasoned grant when the window is clean', async () => {
    process.env.DATABASE_URL = 'postgresql://test-only/unit';
    const created: unknown[] = [];
    const repo = fakeRepo({
      countRecent: async () => 1,
      create: async (input) => {
        created.push(input);
        return { id: 'g9', expiresAt: input.expiresAt };
      },
    });
    const out = await svc(repo).activate({
      personId: 'p1',
      facilityId: 'f1',
      patientId: '33333333-3333-4333-8333-333333333333',
      resourceType: 'patient',
      action: 'read',
      reason: REAL,
    });
    expect(out.grantId).toBe('g9');
    expect(created).toHaveLength(1);
  });

  it('sweepExpired marks lapsed grants', async () => {
    process.env.DATABASE_URL = 'postgresql://test-only/unit';
    const expired = await svc(
      fakeRepo({ expireDue: async () => [{ id: 'g2', personId: 'p1' }] }),
    ).sweepExpired();
    expect(expired).toBe(1);
  });
});
