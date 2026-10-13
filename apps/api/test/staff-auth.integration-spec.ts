import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyCredentialRepository } from './../src/modules/iam/infrastructure/kysely-credential.repository.js';
import { KyselyMembershipRepository } from './../src/modules/iam/infrastructure/kysely-membership.repository.js';
import { StaffAuthService } from './../src/modules/iam/application/staff-auth.service.js';
import { MembershipService } from './../src/modules/iam/application/membership.service.js';
import { AccessPolicyService } from './../src/modules/iam/application/access-policy.service.js';
import { AuthorizationGuard } from './../src/modules/iam/interface/authorization.guard.js';
import { Reflector } from '@nestjs/core';
import { totpAt } from './../src/modules/iam/domain/totp.js';
import { hashToken } from './../src/modules/iam/domain/credentials.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('staff authentication (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let auth: StaffAuthService;
  let memberships: MembershipService;
  let facilityId: string;
  let personId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    auth = new StaffAuthService(new KyselyCredentialRepository(db), outbox);
    memberships = new MembershipService(new KyselyMembershipRepository(db));

    const code = `A${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Auth Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Auth Desk', code: 'AD' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    personId = '22222222-2222-4222-8222-222222222222';
    await db
      .insertInto('iam.membership')
      .values({
        person_id: personId,
        organization_id: org.id,
        facility_id: facilityId,
        roles: ['nurse'],
        privileges: ['patient:read'],
      })
      .execute();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('register -> login -> session resolves membership -> logout revokes', async () => {
    const loginId = `nurse-${Date.now()}`;
    const cred = await auth.register({ personId, loginId, secret: 'long-enough-secret-1' });
    const session = await auth.login({ loginId, secret: 'long-enough-secret-1' });
    expect(session.personId).toBe(personId);

    const resolved = await new KyselyCredentialRepository(db).findSession(
      hashToken(session.token),
    );
    expect(resolved?.personId).toBe(personId);

    const membership = await memberships.findActive(personId, facilityId);
    expect(membership?.privileges).toContain('patient:read');
    const decision = new AccessPolicyService().evaluate({
      personId,
      membership: { ...membership, facilityId } as never,
      facilityId,
      action: 'read',
      resourceType: 'patient',
    });
    expect(decision.allow).toBe(true);

    await auth.logout(session.sessionId);
    const gone = await new KyselyCredentialRepository(db).findSession(hashToken(session.token));
    expect(gone).toBeUndefined();
    void cred;
  });

  it('MFA enroll -> confirm -> login requires live code', async () => {
    const loginId = `mfa-${Date.now()}`;
    const cred = await auth.register({ personId, loginId, secret: 'long-enough-secret-2' });
    const enrolled = await auth.enrollTotp(cred.id);
    expect(enrolled.otpauthUrl).toContain('otpauth://totp/');
    // Wrong code cannot enable (uniform message; code lives in the body).
    await expect(auth.confirmTotp(cred.id, '000000')).rejects.toThrow('Invalid TOTP code');
    // Derive the live code the way an authenticator would is server-side only
    // in tests: read the pending secret directly.
    const pending = await new KyselyCredentialRepository(db).findById(cred.id);
    const live = totpAt(pending?.totpSecret ?? '');
    await expect(auth.confirmTotp(cred.id, live)).resolves.toMatchObject({ enabled: true });
    // Login without TOTP now fails; with live code it passes.
    await expect(
      auth.login({ loginId, secret: 'long-enough-secret-2' }),
    ).rejects.toThrow('Valid TOTP code required');
    const ok = await auth.login({
      loginId,
      secret: 'long-enough-secret-2',
      totp: totpAt(pending?.totpSecret ?? ''),
    });
    expect(ok.sessionId).toBeDefined();
  });

  it('demo headers are denied when the escape hatch is off', async () => {
    const prev = process.env.ALLOW_DEMO_AUTH;
    delete process.env.ALLOW_DEMO_AUTH;
    try {
      const reflector = {
        get: () => ({ action: 'read', resourceType: 'patient' }),
      } as unknown as Reflector;
      const guard = new AuthorizationGuard(
        reflector,
        new AccessPolicyService(),
        memberships,
        new KyselyCredentialRepository(db),
      );
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              'x-tenant-id': '00000000-0000-0000-0000-000000000001',
              'x-facility-id': facilityId,
              'x-demo-privileges': 'patient:read',
            },
            requestContext: { facilityId, correlationId: 'test' },
          }),
        }),
        getHandler: () => ({}),
      };
      await expect(guard.canActivate(ctx as never)).rejects.toThrow(
        'Demo auth is disabled; present a staff session',
      );
    } finally {
      if (prev === undefined) delete process.env.ALLOW_DEMO_AUTH;
      else process.env.ALLOW_DEMO_AUTH = prev;
    }
  });
});
