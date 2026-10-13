import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyDeviceRepository } from './../src/modules/sync/infrastructure/kysely-device.repository.js';
import { KyselySyncRepository } from './../src/modules/sync/infrastructure/kysely-sync.repository.js';
import { DeviceService } from './../src/modules/sync/application/device.service.js';
import { SyncService } from './../src/modules/sync/application/sync.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import { SyncAccessGuard } from './../src/modules/sync/interface/sync-access.guard.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';
import type { ExecutionContext } from '@nestjs/common';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('edge device runtime (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let devices: DeviceService;
  let sync: SyncService;
  let facilityId: string;
  let otherFacilityId: string;
  let patientId: string;
  const RUN = `D${Date.now().toString(36).toUpperCase()}`;

  function ctxOf(headers: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers, correlationId: `it-${RUN}` }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    devices = new DeviceService(new KyselyDeviceRepository(db), outbox);
    sync = new SyncService(
      new KyselySyncRepository(db),
      patientRepo,
      new KyselyEncounterRepository(db),
      new KyselyClinicalRepository(db),
      new PatientService(patientRepo, outbox),
      new EncounterService(new KyselyEncounterRepository(db), patientRepo, outbox),
      outbox,
    );

    const org = await db
      .insertInto('org.organization')
      .values({ name: `DevRt Org ${RUN}`, code: RUN.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Edge Ward', code: 'EW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const fac2 = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Other Ward', code: 'OW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    otherFacilityId = fac2.id;
    patientId = (
      await new PatientService(patientRepo, outbox).register({
        familyName: 'DevRt',
        givenName: 'Pat',
        dateOfBirth: '1997-07-07',
        sex: 'M',
        facilityId,
        mrn: RUN,
      })
    ).patient.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('enroll: token shown once (sha256 at rest); authenticate; facility-scoped list; name taken -> 409', async () => {
    const { device, apiKey } = await devices.enroll({
      facilityId,
      name: `Edge ${RUN}`,
      capabilities: ['observation.', 'patient.'],
      maxDisconnectedHours: 48,
    });
    expect(apiKey.startsWith('pdev_')).toBe(true);
    const stored = await db
      .selectFrom('integration.device')
      .select(['token_hash'])
      .where('id', '=', device.id)
      .executeTakeFirstOrThrow();
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toContain(apiKey);

    const authed = await devices.authenticate(apiKey);
    expect(authed.id).toBe(device.id);
    await expect(devices.authenticate('pdev_bogus')).rejects.toMatchObject({
      response: { code: 'DEVICE_TOKEN_INVALID' },
    });

    const scoped = await devices.list(facilityId);
    expect(scoped.some((d) => d.id === device.id)).toBe(true);
    const elsewhere = await devices.list(otherFacilityId);
    expect(elsewhere.some((d) => d.id === device.id)).toBe(false);

    await expect(
      devices.enroll({ facilityId, name: `Edge ${RUN}`, capabilities: ['*'] }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NAME_TAKEN' } });

    // Outbox facts for lifecycle events.
    const evs = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('type', '=', 'sync.device_enrolled')
      .where('aggregate_id', '=', device.id)
      .execute();
    expect(evs).toHaveLength(1);
  });

  it('feed honors the approved subset (SQL filter); apply denies out-of-scope with no partial writes', async () => {
    const { device, apiKey } = await devices.enroll({
      facilityId,
      name: `Feed ${RUN}`,
      capabilities: ['observation.'],
    });

    // Central facts of two types; only observation.* is in the subset.
    await new OutboxService(db).publish({
      aggregateType: 'clinical_observation',
      aggregateId: randomUUID(),
      type: 'observation.recorded',
      producer: 'clinical',
      payload: { patientId, code: 'TEMP', valueNum: 36.5 },
    });
    await new OutboxService(db).publish({
      aggregateType: 'billing_invoice',
      aggregateId: randomUUID(),
      type: 'billing.invoice_issued',
      producer: 'billing',
      payload: { total: 10 },
    });

    const feed = await sync.feed('', 200, `device:${device.id}`, device.capabilities);
    expect(feed.events.length).toBeGreaterThan(0);
    expect(feed.events.every((e) => e.type.startsWith('observation.'))).toBe(true);
    expect(feed.events.some((e) => e.type.startsWith('billing.'))).toBe(false);

    // Apply: mixed batch with one out-of-scope type -> SYNC_CAPABILITY_DENIED, nothing written.
    const obsEvent = {
      eventId: randomUUID(),
      type: 'observation.recorded',
      aggregateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { patientId, code: 'PULSE', valueNum: 72, unit: 'bpm' },
    };
    const billingEvent = {
      eventId: randomUUID(),
      type: 'billing.invoice_issued',
      aggregateId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { total: 99 },
    };
    await expect(
      sync.apply([obsEvent, billingEvent], { capabilities: device.capabilities }),
    ).rejects.toMatchObject({ response: { code: 'SYNC_CAPABILITY_DENIED' } });

    // Denied batch wrote nothing: the same in-scope event still applies fresh.
    const once = await sync.apply([obsEvent], { capabilities: device.capabilities });
    expect(once.applied).toEqual([obsEvent.eventId]);
    const twice = await sync.apply([obsEvent], { capabilities: device.capabilities });
    expect(twice.skipped).toEqual([obsEvent.eventId]);

    // Device context authenticate still works with the returned token.
    const authed = await devices.authenticate(apiKey);
    expect(authed.capabilities).toEqual(['observation.']);
  });

  it('heartbeat: records pending counts + history; windowExceeded from prior last_seen', async () => {
    const { device, apiKey } = await devices.enroll({
      facilityId,
      name: `Beat ${RUN}`,
      capabilities: ['*'],
      maxDisconnectedHours: 24,
    });
    const authed = await devices.authenticate(apiKey);
    const beat = await devices.heartbeat(authed, {
      pendingOut: 5,
      pendingIn: 2,
      lastSyncAt: new Date().toISOString(),
    });
    expect(beat).toMatchObject({ deviceId: device.id, windowExceeded: false, status: 'active' });

    const history = await db
      .selectFrom('integration.device_heartbeat')
      .select(['pending_out', 'pending_in'])
      .where('device_id', '=', device.id)
      .execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ pending_out: 5, pending_in: 2 });

    // Backdate last_seen beyond the 24h window -> reconnect beat reports exceeded.
    await db
      .updateTable('integration.device')
      .set({ last_seen_at: new Date(Date.now() - 25 * 3_600_000) })
      .where('id', '=', device.id)
      .execute();
    const staleRow = await devices.get(device.id);
    expect(staleRow.windowExceeded).toBe(true);
    expect(staleRow.degraded).toBe(true);
    // Simulate the guard flow: the reconnecting request re-authenticates,
    // so heartbeat sees the backdated last_seen from a fresh row.
    const reconnected = await devices.authenticate(apiKey);
    const late = await devices.heartbeat(reconnected, { pendingOut: 0, pendingIn: 0 });
    expect(late.windowExceeded).toBe(true);
  });

  it('lifecycle: suspend blocks tokens (403), resume restores, decommission is terminal', async () => {
    const { device, apiKey } = await devices.enroll({
      facilityId,
      name: `Life ${RUN}`,
      capabilities: ['patient.'],
    });
    await devices.setStatusAction(device.id, 'suspend');
    await expect(devices.authenticate(apiKey)).rejects.toMatchObject({
      response: { code: 'DEVICE_SUSPENDED' },
    });
    await devices.setStatusAction(device.id, 'resume');
    await expect(devices.authenticate(apiKey)).resolves.toMatchObject({ status: 'active' });
    await devices.setStatusAction(device.id, 'decommission');
    await expect(devices.authenticate(apiKey)).rejects.toMatchObject({
      response: { code: 'DEVICE_DECOMMISSIONED' },
    });
    await expect(devices.setStatusAction(device.id, 'resume')).rejects.toMatchObject({
      response: { code: 'DEVICE_TRANSITION' },
    });
    const evs = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_id', '=', device.id)
      .where('type', 'like', 'sync.device_%')
      .orderBy('type')
      .execute();
    expect(evs.map((e) => e.type)).toEqual([
      'sync.device_decommissioned',
      'sync.device_enrolled',
      'sync.device_resumed',
      'sync.device_suspended',
    ]);
  });

  it('guard: device token attaches facility context; mismatch and suspended tokens are hard denials', async () => {
    const { device, apiKey } = await devices.enroll({
      facilityId,
      name: `Guard ${RUN}`,
      capabilities: ['observation.'],
    });
    const guard = new SyncAccessGuard(
      undefined as never,
      undefined as never,
      devices,
    );

    const ok = { 'x-device-token': apiKey } as Record<string, string>;
    await expect(guard.canActivate(ctxOf(ok))).resolves.toBe(true);

    const mismatch = {
      'x-device-token': apiKey,
      'x-facility-id': otherFacilityId,
    } as Record<string, string>;
    await expect(guard.canActivate(ctxOf(mismatch))).rejects.toMatchObject({
      response: { code: 'DEVICE_FACILITY_MISMATCH' },
    });

    await devices.setStatusAction(device.id, 'suspend');
    const suspended = { 'x-device-token': apiKey } as Record<string, string>;
    await expect(guard.canActivate(ctxOf(suspended))).rejects.toMatchObject({
      response: { code: 'DEVICE_SUSPENDED' },
    });
  });
});
