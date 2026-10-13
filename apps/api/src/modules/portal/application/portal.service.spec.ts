import { PortalService } from './portal.service.js';
import { hashSecret, newSessionToken, verifySecret } from '../domain/portal.repository.js';
import type { PortalRepository } from '../domain/portal.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

describe('portal crypto (pure)', () => {
  it('hashes and verifies secrets; rejects wrong secret and malformed stored', () => {
    const stored = hashSecret('correct-horse-1');
    expect(verifySecret('correct-horse-1', stored)).toBe(true);
    expect(verifySecret('wrong', stored)).toBe(false);
    expect(verifySecret('x', 'garbage')).toBe(false);
    expect(verifySecret('x', 'scrypt$only-two')).toBe(false);
  });

  it('mints unique session tokens', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('PortalService (unit, fake repo)', () => {
  function fake(): PortalRepository {
    const accounts = new Map<string, { id: string; patientId: string; hash: string }>();
    return {
      createAccount: async (input) => {
        const id = 'ac1';
        accounts.set(input.loginId, { id, patientId: input.patientId, hash: input.secretHash });
        return { id };
      },
      findAccountByLogin: async (loginId) => {
        const a = accounts.get(loginId);
        return a ? { id: a.id, patientId: a.patientId, secretHash: a.hash, status: 'active' } : undefined;
      },
      createSession: async () => ({ id: 's1' }),
      findSession: async () => undefined,
      revokeSession: async () => undefined,
      grantProxy: async () => ({ id: 'g1' }),
      findGrant: async () => ({ scopes: ['read'], active: true }),
    };
  }

  it('rejects weak secrets on register (400)', async () => {
    const svc = new PortalService(fake(), new OutboxService(undefined));
    const err = await svc
      .register({ patientId: 'p', loginId: 'u', secret: 'short' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });

  it('registers then logs in; wrong secret gives uniform 401', async () => {
    const svc = new PortalService(fake(), new OutboxService(undefined));
    await svc.register({ patientId: 'p1', loginId: 'jane', secret: 'correct-horse-1' });
    const ok = await svc.login({ loginId: 'jane', secret: 'correct-horse-1' });
    expect(ok.token).toBeDefined();
    expect(ok.patientId).toBe('p1');
    const bad = await svc
      .login({ loginId: 'jane', secret: 'wrong-secret-9' })
      .catch((e: unknown) => e as { status?: number });
    expect((bad as { status?: number }).status).toBe(401);
    const missing = await svc
      .login({ loginId: 'nobody', secret: 'whatever-123' })
      .catch((e: unknown) => e as { status?: number });
    expect((missing as { status?: number }).status).toBe(401);
  });

  it('denies act-as without a grant (401)', async () => {
    const repo = fake();
    repo.findGrant = async () => undefined;
    const svc = new PortalService(repo, new OutboxService(undefined));
    const err = await svc
      .actAs({ proxyAccountId: 'a', dependentPatientId: 'd' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(401);
  });
});
