import { DeviceService } from './device.service.js';
import {
  generateDeviceToken,
  type Device,
  type DeviceRepository,
} from '../domain/device.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

describe('DeviceService (unit, fakes)', () => {
  function store() {
    const rows = new Map<string, Device & { tokenHash: string }>();
    const repo: DeviceRepository = {
      create: async (input) => {
        for (const d of rows.values()) {
          if (d.facilityId === input.facilityId && d.name === input.name) {
            const e = new Error('dup') as Error & { code?: string };
            e.code = '23505';
            throw e;
          }
        }
        const id = `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, '0')}`;
        const d: Device & { tokenHash: string } = {
          id,
          organizationId: 'org-1',
          facilityId: input.facilityId,
          name: input.name,
          kind: input.kind,
          status: 'active',
          capabilities: input.capabilities,
          maxDisconnectedHours: input.maxDisconnectedHours,
          enrolledAt: new Date().toISOString(),
          tokenHash: input.tokenHash,
        };
        rows.set(id, d);
        return d;
      },
      findById: async (id) => rows.get(id),
      findByTokenHash: async (hash) =>
        [...rows.values()].find((d) => d.tokenHash === hash),
      list: async (facilityId) =>
        [...rows.values()].filter((d) => !facilityId || d.facilityId === facilityId),
      setStatus: async (id, status) => {
        const d = rows.get(id);
        if (d) d.status = status;
      },
      recordHeartbeat: async (id, hb) => {
        const d = rows.get(id);
        if (d) d.lastSeenAt = hb.at.toISOString();
      },
    };
    return { rows, repo };
  }

  function svc(repo: DeviceRepository) {
    return new DeviceService(repo, new OutboxService(undefined));
  }

  const enrollIn = (over: Record<string, unknown> = {}) => ({
    facilityId: '00000000-0000-4000-8000-0000000000f1',
    name: 'Ward Edge A',
    capabilities: ['patient.', 'observation.'],
    ...over,
  });

  it('enroll returns raw token once; only hash is stored; token authenticates', async () => {
    const s = svc(store().repo);
    const { device, apiKey } = await s.enroll(enrollIn());
    expect(apiKey.startsWith('pdev_')).toBe(true);
    expect(device.status).toBe('active');
    expect(device.capabilities).toEqual(['patient.', 'observation.']);
    const authed = await s.authenticate(apiKey);
    expect(authed.id).toBe(device.id);
  });

  it('enroll validates name/kind/capabilities/window; name taken -> 409', async () => {
    const s = svc(store().repo);
    await expectCode(s.enroll(enrollIn({ name: 'x' })), 'DEVICE_NAME_INVALID', 400);
    await expectCode(s.enroll(enrollIn({ kind: 'spaceship' })), 'DEVICE_KIND_INVALID', 400);
    await expectCode(s.enroll(enrollIn({ capabilities: [] })), 'DEVICE_CAPABILITIES_INVALID', 400);
    await expectCode(
      s.enroll(enrollIn({ maxDisconnectedHours: 0 })),
      'DEVICE_WINDOW_INVALID',
      400,
    );
    await s.enroll(enrollIn());
    await expectCode(s.enroll(enrollIn()), 'DEVICE_NAME_TAKEN', 409);
  });

  it('authenticate: unknown -> 401; suspended/decommissioned -> 403', async () => {
    const st = store();
    const s = svc(st.repo);
    await expectCode(s.authenticate('pdev_bogus'), 'DEVICE_TOKEN_INVALID', 401);
    const { device, apiKey } = await s.enroll(enrollIn());
    await s.setStatusAction(device.id, 'suspend');
    await expectCode(s.authenticate(apiKey), 'DEVICE_SUSPENDED', 403);
    await s.setStatusAction(device.id, 'resume');
    await s.setStatusAction(device.id, 'decommission');
    await expectCode(s.authenticate(apiKey), 'DEVICE_DECOMMISSIONED', 403);
  });

  it('status transitions: suspend/resume; decommission terminal -> 409', async () => {
    const st = store();
    const s = svc(st.repo);
    const { device } = await s.enroll(enrollIn());
    const suspended = await s.setStatusAction(device.id, 'suspend');
    expect(suspended.status).toBe('suspended');
    await expectCode(s.setStatusAction(device.id, 'suspend'), 'DEVICE_TRANSITION', 409);
    const resumed = await s.setStatusAction(device.id, 'resume');
    expect(resumed.status).toBe('active');
    await s.setStatusAction(device.id, 'decommission');
    await expectCode(s.setStatusAction(device.id, 'resume'), 'DEVICE_TRANSITION', 409);
    await expectCode(s.setStatusAction('missing-id', 'suspend'), 'DEVICE_NOT_FOUND', 404);
  });

  it('heartbeat: records pending counts; windowExceeded from PRIOR last_seen', async () => {
    const st = store();
    const s = svc(st.repo);
    const { device } = await s.enroll(enrollIn({ maxDisconnectedHours: 24 }));
    const fresh = await s.heartbeat(device, { pendingOut: 3, pendingIn: 1 });
    expect(fresh).toMatchObject({
      deviceId: device.id,
      windowExceeded: false,
      status: 'active',
    });
    const seen = await st.repo.findById(device.id);
    expect(seen?.lastSeenAt).toBeTruthy();
    const staleDevice: Device = {
      ...device,
      lastSeenAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    };
    const late = await s.heartbeat(staleDevice, { pendingOut: 0, pendingIn: 0 });
    expect(late.windowExceeded).toBe(true);
    await expectCode(s.heartbeat(device, { pendingOut: -1 }), 'HEARTBEAT_INVALID', 400);
    await expectCode(
      s.heartbeat(device, { lastSyncAt: 'not-a-date' }),
      'HEARTBEAT_INVALID',
      400,
    );
  });

  it('list/get expose degraded flags; unknown id -> 404', async () => {
    const st = store();
    const s = svc(st.repo);
    const { device } = await s.enroll(enrollIn());
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.degraded).toBe(false);
    const got = await s.get(device.id);
    expect(got.id).toBe(device.id);
    await expectCode(
      s.get('00000000-0000-4000-8000-000000000099'),
      'DEVICE_NOT_FOUND',
      404,
    );
  });

  it('token generation is non-deterministic', () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a.raw).not.toBe(b.raw);
  });
});
