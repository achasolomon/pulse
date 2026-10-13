import { totpAt, verifyTotp } from '../domain/totp.js';
import { hashSecret, verifySecret } from '../domain/credentials.js';
import { StaffAuthService } from './staff-auth.service.js';
import type { CredentialRepository } from '../domain/credential.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { totpAt as liveCode } from '../domain/totp.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii').toString('base64');

describe('TOTP (RFC 6238 vectors, SHA-1)', () => {
  it('matches published test vectors', () => {
    expect(totpAt(RFC_SECRET, 59 * 1000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109 * 1000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890 * 1000)).toBe('005924');
  });

  it('accepts ±1 step skew, rejects others', () => {
    const code = totpAt(RFC_SECRET, 59 * 1000);
    expect(verifyTotp(RFC_SECRET, code, 59 * 1000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 89 * 1000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, 149 * 1000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'not-six', 59 * 1000)).toBe(false);
  });
});

describe('staff credentials (pure)', () => {
  it('hashes and verifies; rejects wrong secret and malformed stored', () => {
    const stored = hashSecret('long-enough-secret-1');
    expect(verifySecret('long-enough-secret-1', stored)).toBe(true);
    expect(verifySecret('wrong-secret-000', stored)).toBe(false);
    expect(verifySecret('x', 'garbage')).toBe(false);
  });
});

describe('StaffAuthService (unit, fake repo)', () => {
  function fake(over: Partial<CredentialRepository> = {}) {
    const repo: CredentialRepository = {
      create: async () => ({ id: 'cred1' }),
      findByLogin: async () => ({
        id: 'cred1',
        personId: 'person-1',
        loginId: 'nurse',
        secretHash: hashSecret('long-enough-secret-1'),
        status: 'active',
        totpEnabled: false,
      }),
      findById: async () => undefined,
      setTotp: async () => undefined,
      createSession: async () => ({ id: 's1' }),
      findSession: async () => undefined,
      revokeSession: async () => undefined,
      linkIdentity: async () => ({ id: 'l1' }),
      findIdentity: async () => undefined,
      ...over,
    };
    return repo;
  }

  function svc(repo: CredentialRepository) {
    return new StaffAuthService(repo, new OutboxService(undefined));
  }

  it('rejects weak secrets on register (400)', async () => {
    const err = await svc(fake())
      .register({ loginId: 'u', secret: 'short', personId: 'p1' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });

  it('requires identity linkage on register (400)', async () => {
    const err = await svc(fake())
      .register({ loginId: 'u', secret: 'long-enough-secret-1' })
      .catch((e: unknown) => e as { status?: number });
    expect((err as { status?: number }).status).toBe(400);
  });

  it('logins uniformly fail on bad secret (401) and demand MFA when enabled', async () => {
    const repo = fake();
    repo.findByLogin = async () => ({
      id: 'cred1',
      personId: 'person-1',
      loginId: 'nurse',
      secretHash: hashSecret('long-enough-secret-1'),
      status: 'active',
      totpEnabled: true,
      totpSecret: Buffer.from('12345678901234567890', 'ascii').toString('base64'),
    });
    const s = svc(repo);
    const withoutTotp = await s
      .login({ loginId: 'nurse', secret: 'long-enough-secret-1' })
      .catch((e: unknown) => e as { status?: number });
    expect((withoutTotp as { status?: number }).status).toBe(401);
    const live = liveCode(Buffer.from('12345678901234567890', 'ascii').toString('base64'));
    const ok = await s.login({ loginId: 'nurse', secret: 'long-enough-secret-1', totp: live });
    expect(ok.sessionId).toBe('s1');
  });

  it('logoutByToken revokes a live session and no-ops on unknown tokens', async () => {
    const revoked: string[] = [];
    const repo = fake({
      findSession: async () => ({
        sessionId: 's9',
        credentialId: 'cred1',
        personId: 'person-1',
        scopes: ['staff'],
      }),
      revokeSession: async (id: string) => {
        revoked.push(id);
      },
    });
    const s = svc(repo);
    await expect(s.logoutByToken('staff_abc')).resolves.toEqual({ revoked: true });
    expect(revoked).toEqual(['s9']);
    repo.findSession = async () => undefined;
    await expect(s.logoutByToken('staff_gone')).resolves.toEqual({ revoked: false });
    expect(revoked).toEqual(['s9']);
  });
});
