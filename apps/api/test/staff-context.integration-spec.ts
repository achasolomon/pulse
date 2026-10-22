import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
import type { PulseDatabase } from '../src/platform/database/db.types.js';

describe.skipIf(!process.env.DATABASE_URL)('staff bootstrap HTTP (isolated integration database)', () => {
  let app: INestApplication;
  let db: Kysely<PulseDatabase>;
  let auth: StaffAuthService;
  const personId = randomUUID();
  let organizationId: string;
  let otherOrganizationId: string;
  let facilityId: string;
  let otherFacilityId: string;
  let loginId: string;
  let secret: string;
  let credentialId: string;
  let token: string;
  let sessionId: string;

  beforeAll(async () => {
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
    const code = randomUUID();
    const org = await db.insertInto('org.organization').values({ name: 'W02 authorized group', code: `W02-${code}` }).returning('id').executeTakeFirstOrThrow();
    const other = await db.insertInto('org.organization').values({ name: 'W02 other group', code: `W02-other-${code}` }).returning('id').executeTakeFirstOrThrow();
    organizationId = org.id; otherOrganizationId = other.id;
    const facility = await db.insertInto('org.facility').values({ organization_id: org.id, name: 'W02 test facility', code: 'W02' }).returning('id').executeTakeFirstOrThrow();
    const foreign = await db.insertInto('org.facility').values({ organization_id: other.id, name: 'Other test facility', code: 'OTHER' }).returning('id').executeTakeFirstOrThrow();
    facilityId = facility.id; otherFacilityId = foreign.id;
    await db.insertInto('iam.membership').values([
      { person_id: personId, organization_id: org.id, facility_id: facility.id, roles: ['nurse'], privileges: ['patient:read'] },
      // Independently valid foreign keys must not grant an inconsistent tenant/facility tuple.
      { person_id: personId, organization_id: org.id, facility_id: foreign.id, roles: ['admin'], privileges: ['patient:read'] },
      { person_id: randomUUID(), organization_id: other.id, facility_id: foreign.id, roles: ['nurse'], privileges: ['patient:read'] },
    ]).execute();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(module.createNestApplication()); await app.init();
    auth = app.get(StaffAuthService);
  });
  beforeEach(async () => {
    loginId = `w02-${randomUUID()}`; secret = randomUUID();
    const credential = await auth.register({ personId, loginId, secret }); credentialId = credential.id;
    const session = await auth.login({ loginId, secret }); token = session.token; sessionId = session.sessionId;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('returns only current owned memberships with server identity, expiry and private cache policy', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ personId, loginId, sessionId, facilities: [{ facilityId, organizationId, facilityName: 'W02 test facility' }] });
    expect(res.body.facilities).toHaveLength(1);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
    expect(res.body).not.toHaveProperty('token'); expect(res.body).not.toHaveProperty('secretHash');
  });
  it('rejects missing, malformed, revoked, expired and disabled sessions', async () => {
    await request(app.getHttpServer()).get('/api/v1/iam/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', 'Bearer staff_bad').expect(401);
    await db.updateTable('iam.session').set({ expires_at: new Date(0) }).where('id', '=', sessionId).execute();
    await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    const second = await auth.login({ loginId, secret });
    await request(app.getHttpServer()).post('/api/v1/iam/auth/logout').set('Authorization', `Bearer ${second.token}`).expect(201);
    await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', `Bearer ${second.token}`).expect(401);
    const third = await auth.login({ loginId, secret });
    await db.updateTable('iam.credential').set({ status: 'disabled' }).where('id', '=', credentialId).execute();
    await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', `Bearer ${third.token}`).expect(401);
  });
  it('binds staff access to the actual organization and facility; demo headers cannot supply missing scope', async () => {
    const ping = () => request(app.getHttpServer()).get('/api/v1/secure/ping').set('Authorization', `Bearer ${token}`);
    await ping().set('x-tenant-id', organizationId).set('x-facility-id', facilityId).expect(200);
    await ping().set('x-tenant-id', otherOrganizationId).set('x-facility-id', facilityId).expect(403);
    await ping().set('x-tenant-id', organizationId).set('x-facility-id', otherFacilityId).set('x-demo-privileges', 'patient:read').expect(403);
  });
  it('refreshes membership expiry and does not advertise stale capabilities', async () => {
    await db.updateTable('iam.membership').set({ effective_to: new Date(0) }).where('person_id', '=', personId).where('facility_id', '=', facilityId).execute();
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/iam/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.facilities).toEqual([]);
    } finally {
      await db.updateTable('iam.membership').set({ effective_to: null }).where('person_id', '=', personId).where('facility_id', '=', facilityId).execute();
    }
  });
});
