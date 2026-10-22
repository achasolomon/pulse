import { AccountSecurityService } from './account-security.service.js';
import type { CredentialRepository } from '../domain/credential.repository.js';
import type { AccountSecurityRepository } from '../domain/account-security.repository.js';
import type { StaffAuthService } from './staff-auth.service.js';
import { hashSecret } from '../domain/credentials.js';
import { otpauthUrl, totpAt } from '../domain/totp.js';
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));
describe('Staff account security', () => {
  const totpSecret = Buffer.from('12345678901234567890').toString('base64');
  function fixture(enabled = false) {
    const c = {
      id: 'credential-a',
      personId: 'person-a',
      loginId: 'staff-a',
      status: 'active',
      secretHash: hashSecret('correct-secret-123'),
      totpEnabled: enabled,
      totpSecret,
    };
    const credentials = {
      findSession: vi.fn(async () => ({
        credentialId: c.id,
        personId: c.personId,
        expiresAt: new Date(Date.now() + 60000),
      })),
      findById: vi.fn(async () => c),
    };
    const accounts = {
      status: vi.fn(),
      findRecoveryCredential: vi.fn(async () => ({
        id: c.id,
        email: 'staff@pulse.test',
      })),
      createRequest: vi.fn(
        async (
          _input: Parameters<AccountSecurityRepository['createRequest']>[0],
        ) => undefined,
      ),
      pendingMail: vi.fn(async () => [] as never[]),
      markDelivered: vi.fn(async () => undefined),
      resetPassword: vi.fn(async () => true),
      verifyEmail: vi.fn(async () => true),
      setMfaAndRevoke: vi.fn(async () => true),
    };
    const auth = {
      enrollTotp: vi.fn(async () => ({
        otpauthUrl: otpauthUrl(totpSecret, 'staff-a'),
      })),
    };
    const service = new AccountSecurityService(
      credentials as unknown as CredentialRepository,
      accounts as unknown as AccountSecurityRepository,
      auth as unknown as StaffAuthService,
    );
    return {
      service,
      credentials,
      accounts,
      auth,
      c,
      authorization: `Bearer staff_${'a'.repeat(64)}`,
    };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('SMTP_FROM', 'no-reply@pulse.test');
    vi.stubEnv('STAFF_WEB_ORIGIN', 'http://localhost:3001');
    vi.stubEnv(
      'STAFF_RECOVERY_MAIL_KEY',
      'test-recovery-key-32-characters-long',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'local-test');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('queues encrypted links and gives unknown accounts the same public response', async () => {
    const f = fixture();
    expect(await f.service.requestReset('staff-a')).toEqual({ accepted: true });
    const job = f.accounts.createRequest.mock.calls[0]?.[0] as unknown as {
      tokenHash: string;
      encryptedToken: string;
      purpose: string;
      expiresAt: Date;
    };
    expect(job.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(job.encryptedToken).toBeTruthy();
    expect(job.purpose).toBe('password_reset');
    expect(job.expiresAt.getTime()).toBeGreaterThan(Date.now());
    f.accounts.findRecoveryCredential.mockResolvedValueOnce(undefined as never);
    expect(await f.service.requestReset('unknown')).toEqual({ accepted: true });
    expect(f.accounts.createRequest).toHaveBeenCalledTimes(1);
  });
  it('delivers links with token fragments; tampered ciphertext never sends', async () => {
    const f = fixture();
    await f.service.requestReset('staff-a');
    const job = f.accounts.createRequest.mock.calls[0]?.[0];
    f.accounts.pendingMail.mockResolvedValueOnce([job] as never[]);
    await f.service.deliverMail();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('/reset-password#token='),
      }),
    );
    expect(f.accounts.markDelivered).toHaveBeenCalledTimes(1);
    sendMail.mockClear();
    f.accounts.pendingMail.mockResolvedValueOnce([
      { ...(job as object), encryptedToken: 'bad-ciphertext' },
    ] as never[]);
    await f.service.deliverMail();
    expect(sendMail).not.toHaveBeenCalled();
    expect(f.accounts.markDelivered).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed/used reset links and exposes no reset token', async () => {
    const f = fixture();
    await expect(
      f.service.finishReset('short', 'long-new-secret'),
    ).rejects.toThrow();
    expect(f.accounts.resetPassword).not.toHaveBeenCalled();
    expect(
      await f.service.finishReset('a'.repeat(43), 'long-new-secret'),
    ).toEqual({ changed: true });
    f.accounts.resetPassword.mockResolvedValueOnce(false);
    await expect(
      f.service.finishReset('a'.repeat(43), 'long-new-secret'),
    ).rejects.toThrow();
  });
  it('binds email verification to the authenticated credential', async () => {
    const f = fixture();
    await f.service.verifyEmail(f.authorization, 'b'.repeat(43));
    expect(f.accounts.verifyEmail).toHaveBeenCalledWith(
      expect.any(String),
      f.c.id,
    );
    await expect(
      f.service.verifyEmail(undefined, 'b'.repeat(43)),
    ).rejects.toThrow();
    f.credentials.findSession.mockResolvedValueOnce(undefined as never);
    await expect(f.service.status(f.authorization)).rejects.toThrow();
  });
  it('requires password and verified code for opt-in MFA; cannot overwrite enabled MFA', async () => {
    const f = fixture();
    await expect(
      f.service.enroll(f.authorization, 'wrong-secret'),
    ).rejects.toThrow();
    expect(f.auth.enrollTotp).not.toHaveBeenCalled();
    await f.service.enroll(f.authorization, 'correct-secret-123');
    expect(f.auth.enrollTotp).toHaveBeenCalledWith(f.c.id);
    const codes = new Set(
      [-30000, 0, 30000].map((n) => totpAt(totpSecret, Date.now() + n)),
    );
    const bad = ['000000', '111111', '222222', '333333'].find(
      (n) => !codes.has(n),
    )!;
    await expect(f.service.confirm(f.authorization, bad)).rejects.toThrow();
    expect(f.accounts.setMfaAndRevoke).not.toHaveBeenCalled();
    await f.service.confirm(f.authorization, totpAt(totpSecret));
    expect(f.accounts.setMfaAndRevoke).toHaveBeenCalledWith(
      f.c.id,
      totpSecret,
      true,
    );
    const enabled = fixture(true);
    await expect(
      enabled.service.enroll(enabled.authorization, 'correct-secret-123'),
    ).rejects.toThrow();
  });
  it('disabling MFA requires password plus code and revokes sessions atomically', async () => {
    const f = fixture(true);
    await expect(
      f.service.disable(f.authorization, 'wrong-secret', totpAt(totpSecret)),
    ).rejects.toThrow();
    expect(f.accounts.setMfaAndRevoke).not.toHaveBeenCalled();
    await f.service.disable(
      f.authorization,
      'correct-secret-123',
      totpAt(totpSecret),
    );
    expect(f.accounts.setMfaAndRevoke).toHaveBeenCalledWith(
      f.c.id,
      totpSecret,
      false,
    );
  });
  it('uses standard Base32 setup keys for authenticator apps', () => {
    expect(
      new URL(otpauthUrl(totpSecret, 'staff-a')).searchParams.get('secret'),
    ).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
});
