import type { ExecutionContext } from '@nestjs/common';
import { PartnerApiKeyGuard } from './partner-key.guard.js';
import { PartnerWriteScopeGuard } from './partner-write-scope.guard.js';
import type { PartnerRepository } from '../infrastructure/partner.repository.js';

function ctx(headers: Record<string, unknown>, req: Record<string, unknown> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, ...req }),
    }),
  } as unknown as ExecutionContext;
}

describe('PartnerWriteScopeGuard', () => {
  const guard = new PartnerWriteScopeGuard();

  it('allows keys with the write scope', () => {
    expect(guard.canActivate(ctx({}, { partnerScopes: ['read', 'write'] }))).toBe(true);
  });

  it('denies read-only or missing scopes (403 PARTNER_SCOPE_DENIED)', () => {
    for (const scopes of [['read'], [], undefined]) {
      let caught: unknown;
      try {
        guard.canActivate(ctx({}, { partnerScopes: scopes }));
      } catch (e) {
        caught = e;
      }
      expect((caught as { status?: number }).status).toBe(403);
      expect((caught as { response?: { code?: string } }).response?.code).toBe(
        'PARTNER_SCOPE_DENIED',
      );
    }
  });
});

describe('PartnerApiKeyGuard (dev fallback)', () => {
  const partners = {
    async findByHash() {
      return undefined;
    },
  } as unknown as PartnerRepository;
  const guard = new PartnerApiKeyGuard(partners);
  const hadDb = process.env.DATABASE_URL;

  afterEach(() => {
    if (hadDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = hadDb;
  });

  it('attaches dev partner id and read/write scopes without a DB', async () => {
    delete process.env.DATABASE_URL;
    const request: Record<string, unknown> = {
      headers: { 'x-api-key': 'pulse-dev-partner' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['partnerId']).toBe('dev-partner');
    expect(request['partnerScopes']).toEqual(['read', 'write']);
  });

  it('rejects unknown keys without a DB (401)', async () => {
    delete process.env.DATABASE_URL;
    await expect(
      guard.canActivate(ctx({ 'x-api-key': 'nope' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects missing keys (401 PARTNER_KEY_REQUIRED)', async () => {
    delete process.env.DATABASE_URL;
    await expect(guard.canActivate(ctx({}))).rejects.toMatchObject({ status: 401 });
  });
});
