import type { ExecutionContext } from '@nestjs/common';
import { SyncAccessGuard } from './sync-access.guard.js';
import type { Device } from '../domain/device.repository.js';
import type { DeviceService } from '../application/device.service.js';
import type { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';

type Req = Record<string, unknown> & {
  headers: Record<string, string | string[] | undefined>;
};

function ctxOf(req: Req): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function fakeGuards(deviceService?: Partial<DeviceService>) {
  let tenantCalls = 0;
  let authzCalls = 0;
  const tenant = {
    canActivate: () => {
      tenantCalls += 1;
      return true;
    },
  } as unknown as TenantContextGuard;
  const authz = {
    canActivate: async () => {
      authzCalls += 1;
      return true;
    },
  } as unknown as AuthorizationGuard;
  const devices = (deviceService ?? {}) as DeviceService;
  const guard = new SyncAccessGuard(tenant, authz, devices);
  return {
    guard,
    counts: () => ({ tenantCalls, authzCalls }),
  };
}

const activeDevice: Device = {
  id: 'd1',
  organizationId: 'org-1',
  facilityId: '00000000-0000-4000-8000-0000000000f1',
  name: 'edge-a',
  kind: 'edge-gateway',
  status: 'active',
  capabilities: ['patient.', 'observation.'],
  maxDisconnectedHours: 72,
  enrolledAt: new Date().toISOString(),
};

describe('SyncAccessGuard (unit)', () => {
  const hadDb = process.env.DATABASE_URL;

  afterEach(() => {
    if (hadDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = hadDb;
  });

  it('staff path: no device token delegates to tenant + authz guards in order', async () => {
    delete process.env.DATABASE_URL;
    const { guard, counts } = fakeGuards();
    const req: Req = { headers: {} };
    await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(counts()).toEqual({ tenantCalls: 1, authzCalls: 1 });
  });

  it('device path: valid token attaches device + requestContext, skips staff guards', async () => {
    delete process.env.DATABASE_URL;
    const { guard, counts } = fakeGuards({ authenticate: async () => activeDevice });
    const req: Req = { headers: { 'x-device-token': 'pulse-dev-device' } };
    await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(counts()).toEqual({ tenantCalls: 0, authzCalls: 0 });
    const r = req as { edgeDevice?: Device; requestContext?: { facilityId?: string; tenantId?: string } };
    expect(r.edgeDevice?.id).toBe('dev-device');
    expect(r.requestContext?.facilityId).toBe('00000000-0000-0000-4000-000000000000');
    expect(r.requestContext?.tenantId).toBe('dev-org');
  });

  it('device path without DB: unknown token -> 401 DEVICE_TOKEN_INVALID (no fail-open)', async () => {
    delete process.env.DATABASE_URL;
    const { guard, counts } = fakeGuards();
    const req: Req = { headers: { 'x-device-token': 'pdev_not-real' } };
    try {
      await guard.canActivate(ctxOf(req));
      throw new Error('expected rejection');
    } catch (err) {
      const e = err as { getStatus: () => number; getResponse: () => unknown };
      expect(e.getStatus()).toBe(401);
      expect((e.getResponse() as { code?: string }).code).toBe('DEVICE_TOKEN_INVALID');
    }
    expect(counts()).toEqual({ tenantCalls: 0, authzCalls: 0 });
  });

  it('device path with DB: authenticate is used; facility mismatch -> 403', async () => {
    process.env.DATABASE_URL = 'postgresql://test-only';
    const { guard } = fakeGuards({ authenticate: async () => activeDevice });
    const ok: Req = {
      headers: {
        'x-device-token': 'pdev_abc',
        'x-facility-id': '00000000-0000-4000-8000-0000000000f1',
      },
    };
    await expect(guard.canActivate(ctxOf(ok))).resolves.toBe(true);
    const bad: Req = {
      headers: {
        'x-device-token': 'pdev_abc',
        'x-facility-id': '00000000-0000-4000-8000-0000000000ff',
      },
    };
    try {
      await guard.canActivate(ctxOf(bad));
      throw new Error('expected rejection');
    } catch (err) {
      const e = err as { getStatus: () => number; getResponse: () => unknown };
      expect(e.getStatus()).toBe(403);
      expect((e.getResponse() as { code?: string }).code).toBe('DEVICE_FACILITY_MISMATCH');
    }
  });

  it('device path with DB: authenticate rejections propagate (no fail-open)', async () => {
    process.env.DATABASE_URL = 'postgresql://test-only';
    const { guard } = fakeGuards({
      authenticate: async () => {
        const err = new Error('Device is suspended') as Error & {
          getStatus?: () => number;
          getResponse?: () => unknown;
        };
        err.getStatus = () => 403;
        err.getResponse = () => ({ code: 'DEVICE_SUSPENDED' });
        throw err;
      },
    });
    const req: Req = { headers: { 'x-device-token': 'pdev_abc' } };
    await expect(guard.canActivate(ctxOf(req))).rejects.toThrow('Device is suspended');
  });

  it('array-valued device token header is unwrapped', async () => {
    delete process.env.DATABASE_URL;
    const { guard } = fakeGuards({ authenticate: async () => activeDevice });
    process.env.DATABASE_URL = 'postgresql://test-only';
    const req: Req = { headers: { 'x-device-token': ['pdev_abc'] } };
    await expect(guard.canActivate(ctxOf(req))).resolves.toBe(true);
  });
});
