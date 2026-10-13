import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyFindingRepository } from './../src/modules/security/infrastructure/kysely-finding.repository.js';
import { KyselySecurityEventRepository } from './../src/modules/security/infrastructure/kysely-security-event.repository.js';
import { FindingService } from './../src/modules/security/application/finding.service.js';
import { SiemService } from './../src/modules/security/application/siem.service.js';
import {
  SecurityEventService,
  actorFromHeaders,
  classifySecurityFailure,
} from './../src/platform/security/security-event.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('security SIEM + findings (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let securityEvents: SecurityEventService;
  let siem: SiemService;
  let findings: FindingService;
  const RUN = `S${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    securityEvents = new SecurityEventService(db);
    siem = new SiemService(new KyselySecurityEventRepository(db));
    findings = new FindingService(
      new KyselyFindingRepository(db),
      new OutboxService(db),
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('security event feed: cursor pages, severity/category filters, no PHI details', async () => {
    const actor = `attacker-${RUN}`;
    for (let i = 0; i < 3; i += 1) {
      const classified = classifySecurityFailure(401, 'STAFF_SESSION_INVALID');
      await securityEvents.record({
        ...classified!,
        actorType: 'unknown',
        actorId: actor,
        correlationId: `corr-${RUN}-${i}`,
        details: { status: 401, code: 'STAFF_SESSION_INVALID', path: '/api/v1/patients', method: 'GET' },
      });
    }
    await securityEvents.record({
      category: 'authz',
      action: 'authz.access_denied',
      severity: 'medium',
      actorType: 'person',
      actorId: `insider-${RUN}`,
      details: { status: 403, code: 'ACCESS_DENIED' },
    });

    const page1 = await siem.feed('', 2, { category: 'authn' });
    expect(page1.events.length).toBeGreaterThan(0);
    expect(page1.events.every((e) => e.category === 'authn')).toBe(true);
    const page2 = await siem.feed(page1.cursor, 100, { category: 'authn' });
    const ids = new Set([...page1.events, ...page2.events].map((e) => e.id));
    expect(ids.size).toBe(page1.events.length + page2.events.length);

    const authzOnly = await siem.feed('', 50, { category: 'authz' });
    expect(authzOnly.events.some((e) => e.actorId === `insider-${RUN}`)).toBe(true);
    expect(authzOnly.events.every((e) => e.category === 'authz')).toBe(true);

    // Telemetry carries operational codes only, never request bodies.
    const sample = page1.events[0];
    expect(Object.keys(sample?.details ?? {})).toEqual(
      expect.arrayContaining(['status', 'code', 'path', 'method']),
    );
    expect(JSON.stringify(sample?.details)).not.toContain('password');
  });

  it('detections: repeated auth failures and mass patient touches fire at thresholds', async () => {
    const attacker = `dos-${RUN}`;
    for (let i = 0; i < 11; i += 1) {
      await securityEvents.record({
        category: 'authn',
        action: 'authn.credential_rejected',
        severity: 'medium',
        actorType: 'unknown',
        actorId: attacker,
        details: { status: 401 },
      });
    }
    const personId = randomUUID();
    const facilityId = randomUUID();
    for (let i = 0; i < 26; i += 1) {
      await db
        .insertInto('audit.audit_event')
        .values({
          actor_id: personId,
          actor_type: 'person',
          action: 'patient.view',
          resource_type: 'patient',
          resource_id: randomUUID(),
          facility_id: facilityId,
          metadata: JSON.stringify({ run: RUN }),
        })
        .execute();
    }

    const det = await siem.detections();
    expect(det.windowMinutes).toBe(15);
    const cluster = det.repeatedAuthFailures.find((c) => c.actorId === attacker);
    expect(cluster).toBeDefined();
    expect(cluster?.failures).toBeGreaterThanOrEqual(11);
    const touches = det.massPatientTouches.find((c) => c.actorId === personId);
    expect(touches).toBeDefined();
    expect(touches?.touches).toBeGreaterThanOrEqual(26);
  });

  it('findings lifecycle: intake -> triage -> mitigate; accept path; closed states terminal', async () => {
    const f1 = await findings.create({
      title: `IDOR on patient export ${RUN}`,
      severity: 'high',
      component: 'api/patient-export',
      vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N',
      evidence: 'GET /patients/:id/export returned other-tenant rows with a valid session',
      owner: 'platform-team',
    });
    expect(f1.status).toBe('open');

    const triaged = await findings.act(f1.id, 'triage', {
      triagedBy: 'sec-ops',
      owner: 'platform-team',
    });
    expect(triaged.status).toBe('triaged');
    expect(triaged.triagedBy).toBe('sec-ops');

    const mitigated = await findings.act(f1.id, 'mitigate', {
      remediation: 'Tenant-scoped the export query; regression test added',
    });
    expect(mitigated.status).toBe('mitigated');
    await expect(findings.act(f1.id, 'triage')).rejects.toMatchObject({
      response: { code: 'FINDING_TRANSITION' },
    });

    const f2 = await findings.create({
      title: `Verbose auth error ${RUN}`,
      severity: 'low',
      component: 'api/auth',
    });
    const accepted = await findings.act(f2.id, 'accept', {
      owner: 'security-lead',
      remediation: 'Accepted: generic message already; residual enum noise documented',
    });
    expect(accepted.status).toBe('accepted');

    const open = await findings.list({ status: 'open' });
    expect(open.some((f) => f.id === f1.id || f.id === f2.id)).toBe(false);
    const high = await findings.list({ severity: 'high' });
    expect(high.some((f) => f.id === f1.id)).toBe(true);
  });

  it('actorFromHeaders maps headers without leaking token material', () => {
    const a = actorFromHeaders({
      'x-device-token': `pdev_${RUN}_secret`,
      'x-facility-id': '00000000-0000-4000-8000-000000000002',
    });
    expect(a).toEqual({
      actorType: 'device',
      actorId: 'device-token',
      facilityId: '00000000-0000-4000-8000-000000000002',
    });
    expect(JSON.stringify(a)).not.toContain(RUN);
  });
});
