import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/platform/bootstrap.js';

// Demo-header auth is test-only surface: enabled here, denied by default
// everywhere else (production requires staff sessions). See SPRINT_25.
process.env.ALLOW_DEMO_AUTH = 'true';

describe('Platform (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/v1 (GET) hello', () => {
    return request(app.getHttpServer()).get('/api/v1').expect(200);
  });

  it('/api/v1/health/live (GET) ok + correlation header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('/api/v1/health/ready (GET) ok', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect((res: { body: { status: string } }) => {
        if (res.body.status !== 'ok') throw new Error('not ready');
      });
  });

  it('unknown route returns ProblemDetails', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope-missing')
      .expect(404);
    expect(res.body.title).toBeDefined();
    expect(res.body.status).toBe(404);
    expect(res.body.instance).toBeDefined();
  });

  it('/api/v1/secure/ping denies without context (403 ProblemDetails)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .expect(403);
    expect(res.body.status).toBe(403);
    expect(res.body.title).toBeDefined();
  });

  it('/api/v1/secure/ping denies cross-privilege (403 ACCESS_DENIED)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/secure/ping allows with context + privilege', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.facilityId).toBe('00000000-0000-0000-0000-000000000002');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('/api/v1/patients denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/patients')
      .send({})
      .expect(403);
  });

  it('/api/v1/patients validates body (400, no PHI echo)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:write')
      .send({ familyName: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/encounters denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/encounters')
      .send({})
      .expect(403);
  });

  it('/api/v1/encounters validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/encounters')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'encounter:write')
      .send({ type: 'inpatient' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/appointments denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/appointments')
      .send({})
      .expect(403);
  });

  it('/api/v1/clinical/notes validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/clinical/notes')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'note:write')
      .send({ chiefComplaint: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/lab/orders denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/lab/orders')
      .send({})
      .expect(403);
  });

  it('/api/v1/lab/tests validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/lab/tests')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'lab_catalog:manage')
      .send({ code: '', name: 'x' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/imaging/orders denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/imaging/orders')
      .send({})
      .expect(403);
  });

  it('/api/v1/medications/prescriptions validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/medications/prescriptions')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'medication:prescribe')
      .send({ dose: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/inventory/items denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/inventory/items')
      .send({})
      .expect(403);
  });

  it('/api/v1/workflow/tasks validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/workflow/tasks')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'task:create')
      .send({ kind: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/revenue/charges denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/revenue/charges')
      .send({})
      .expect(403);
  });

  it('/api/v1/revenue/charges validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/revenue/charges')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'charge:capture')
      .send({ quantity: 0 })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/fhir/v1/metadata is public (CapabilityStatement R4)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/fhir/v1/metadata')
      .expect(200);
    expect(res.body.resourceType).toBe('CapabilityStatement');
    expect(res.body.fhirVersion).toBe('4.0.1');
  });

  it('/api/v1/fhir/v1/Patient/:id denies without partner key (401)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/fhir/v1/Patient/00000000-0000-0000-0000-000000000001')
      .expect(401);
  });

  it('/api/v1/insurance/payers denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/insurance/payers')
      .send({})
      .expect(403);
  });

  it('/api/v1/referrals denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/referrals')
      .send({})
      .expect(403);
  });

  it('/api/v1/consent validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/consent')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'consent:capture')
      .send({ purpose: 'referral' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/revenue/charges/:id/allocate validates shares (400 on bad split)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/revenue/charges/11111111-1111-4111-8111-111111111111/allocate')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'billing:allocate')
      .send({ shares: 'not-an-array' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/clinical/handovers denies without context (403)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/clinical/handovers?facilityId=00000000-0000-0000-0000-000000000002')
      .expect(403);
  });

  it('/api/v1/reports/census denies without context (403)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/reports/census?facilityId=00000000-0000-0000-0000-000000000002')
      .expect(403);
  });

  it('/api/v1/portal/me denies without token (401)', () => {
    return request(app.getHttpServer()).get('/api/v1/portal/me').expect(401);
  });

  it('/api/v1/portal/auth/login validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/auth/login')
      .send({ loginId: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('security headers are present, powered-by is hidden', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('/api/v1/metrics exposes Prometheus counters', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
    expect(res.text).toContain('pulse_http_requests_total');
    expect(res.text).toContain('pulse_http_latency_ms_bucket');
  });

  it('portal login is rate-limited (429 after burst)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/portal/auth/login')
        .send({ loginId: `burst-${i}`, secret: 'wrong-secret-9' });
    }
    await request(app.getHttpServer())
      .post('/api/v1/portal/auth/login')
      .send({ loginId: 'burst-5', secret: 'wrong-secret-9' })
      .expect(429);
  });

  it('break-glass requires a real justification (403 on throwaway)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .set('x-break-glass-reason', 'urgent')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('BREAK_GLASS_REASON_REQUIRED');
  });

  it('break-glass with justification passes the guard', () => {
    return request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .set('x-break-glass-reason', 'cardiac arrest in ED, on-call unreachable')
      .expect(200);
  });

  it('/api/v1/sync/feed denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/sync/feed').expect(403);
  });

  it('/api/v1/sync/apply validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/apply')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sync:write')
      .send({ events: 'not-an-array' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/insurance/benefits denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/insurance/benefits')
      .send({})
      .expect(403);
  });

  it('/api/v1/insurance/benefits/apply validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/insurance/benefits/apply')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'benefit:apply')
      .send({})
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/emergency/waiting denies without context (403)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/emergency/waiting?facilityId=00000000-0000-0000-0000-000000000002')
      .expect(403);
  });

  it('/api/v1/emergency/acuity validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/emergency/acuity')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'emergency:score')
      .send({ level: 9 })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/theatre/bookings denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/theatre/bookings')
      .send({})
      .expect(403);
  });

  it('/api/v1/theatre/suites validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/theatre/suites')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'theatre:manage')
      .send({ name: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/bloodbank/units denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/bloodbank/units')
      .send({})
      .expect(403);
  });

  it('/api/v1/bloodbank/units validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bloodbank/units')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'blood:register')
      .send({ abo: 'Z' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/iam/auth/register denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/iam/auth/register')
      .send({})
      .expect(403);
  });

  it('/api/v1/iam/auth/login validates body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/iam/auth/login')
      .send({ loginId: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('contextual authz: break-glass expands a missing clinical privilege (200)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-break-glass-reason', 'cardiac arrest in ED, on-call unreachable')
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('contextual authz: financial resources are never break-glass eligible (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/revenue/charges')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-break-glass-reason', 'cardiac arrest in ED, on-call unreachable')
      .send({})
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('DENY_BREAK_GLASS_INELIGIBLE');
  });

  it('contextual authz: x-patient-id must be a UUID (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .set('x-patient-id', 'not-a-uuid')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('PATIENT_CONTEXT_INVALID');
  });

  it('contextual authz: x-purpose must be a known purpose (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .set('x-purpose', 'curiosity')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('DENY_PURPOSE_INVALID');
  });

  it('contextual authz: patient scope narrows without a care relationship (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/secure/ping')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .set('x-patient-id', '00000000-0000-0000-0000-00000000000a')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('DENY_NO_CARE_RELATIONSHIP');
  });

  it('/api/v1/organizations/:id/departments denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000001/departments')
      .send({ name: '', code: '' })
      .expect(403);
  });

  it('/api/v1/organizations/:id/departments validates body (400, no PHI echo)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000001/departments')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'facility:manage')
      .send({ name: '', code: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/organizations/:id/units denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000001/units')
      .send({ name: '', code: '' })
      .expect(403);
  });

  it('/api/v1/organizations/:id/locations denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000001/locations')
      .send({ unitId: '', name: '', code: '', kind: 'bad' })
      .expect(403);
  });

  it('/api/v1/anatomy/models denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/anatomy/models')
      .send({ vendor: 'v', modelName: 'm', version: '1' })
      .expect(403);
  });

  it('/api/v1/anatomy/findings denies without context (403)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/anatomy/findings')
      .send({ patientId: '00000000-0000-0000-0000-00000000000a', encounterId: '00000000-0000-0000-0000-00000000000b', anatomyModelId: '00000000-0000-0000-0000-00000000000c', anatomyStructureId: '00000000-0000-0000-0000-00000000000d', findingType: 'pain', authorId: '00000000-0000-0000-0000-00000000000e' })
      .expect(403);
  });

  it('/api/v1/anatomy/models denies without privilege (403 ACCESS_DENIED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/anatomy/models')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .send({ vendor: 'v', modelName: 'm', version: '1' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/anatomy/models validates body (400, no DB)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/anatomy/models')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'anatomy_catalog:manage')
      .send({ vendor: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/anatomy/findings validates body (400, no DB)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/anatomy/findings')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'anatomy:document')
      .send({ patientId: 'not-a-uuid' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/anatomy/findings requires patientId query (400)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/anatomy/findings')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'anatomy:read')
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('PATIENT_ID_REQUIRED');
  });

  it('/api/v1/fhir/v1/Condition denies without partner key (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/Condition')
      .send({ resourceType: 'Condition' })
      .expect(401);
    expect(JSON.stringify(res.body)).toContain('PARTNER_KEY_REQUIRED');
  });

  it('/api/v1/fhir/v1/Condition rejects unknown partner key (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/Condition')
      .set('x-api-key', 'pulse-not-a-real-key')
      .send({ resourceType: 'Condition' })
      .expect(401);
    expect(JSON.stringify(res.body)).toContain('PARTNER_UNKNOWN');
  });

  it('/api/v1/fhir/v1/Condition validates payload with partner key (400 OperationOutcome, no DB)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/Condition')
      .set('x-api-key', 'pulse-dev-partner')
      .send({ resourceType: 'Condition' })
      .expect(400);
    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(JSON.stringify(res.body)).toContain('FHIR_VALIDATION');
  });

  it('/api/v1/fhir/v1/AllergyIntolerance validates payload (400 OperationOutcome)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/AllergyIntolerance')
      .set('x-api-key', 'pulse-dev-partner')
      .send({ resourceType: 'AllergyIntolerance' })
      .expect(400);
    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(JSON.stringify(res.body)).toContain('AllergyIntolerance.code');
  });

  it('/api/v1/fhir/v1/hl7v2/oru validates the message DTO (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/hl7v2/oru')
      .set('x-api-key', 'pulse-dev-partner')
      .send({})
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/fhir/v1/hl7v2/oru NACKs a non-HL7 payload (400 OperationOutcome, no DB)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fhir/v1/hl7v2/oru')
      .set('x-api-key', 'pulse-dev-partner')
      .send({ message: 'this is not hl7' })
      .expect(400);
    expect(res.body.resourceType).toBe('OperationOutcome');
    expect(JSON.stringify(res.body)).toContain('HL7V2_PARSE');
  });

  it('/api/v1/fhir/v1/metadata advertises approved create interactions', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/fhir/v1/metadata')
      .expect(200);
    const resources = res.body.rest[0].resource as { type: string; interaction: { code: string }[] }[];
    const creating = resources
      .filter((r) => r.interaction.some((i) => i.code === 'create'))
      .map((r) => r.type)
      .sort();
    expect(creating).toEqual(['AllergyIntolerance', 'Condition', 'Observation']);
  });

  it('/api/v1/sre/alerts denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/sre/alerts').expect(403);
  });

  it('/api/v1/sre/alerts denies without sre:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/sre/alerts')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/sre/alerts/evaluate requires sre:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sre/alerts/evaluate')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sre:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/sre/backups register validates kind (400 with sre:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sre/backups')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sre:manage')
      .send({ kind: 'tape' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/dialysis/programs denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/dialysis/programs').expect(403);
  });

  it('/api/v1/dialysis/programs denies without dialysis:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dialysis/programs')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/dialysis/programs create requires dialysis:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dialysis/programs')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'dialysis:read')
      .send({ patientId: 'x', facilityId: 'x', protocolId: 'x', accessType: 'fistula', targetWeightKg: 68 })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/dialysis/programs create validates DTO (400 with dialysis:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dialysis/programs')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'dialysis:manage')
      .send({ accessType: 'straw', targetWeightKg: 5 })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/equipment/assets denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/equipment/assets').expect(403);
  });

  it('/api/v1/equipment/assets denies without equipment:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/equipment/assets')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/equipment/assets commission requires equipment:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/equipment/assets')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'equipment:read')
      .send({
        facilityId: 'x',
        name: 'x',
        manufacturer: 'x',
        model: 'x',
        serial: 'x',
      })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/equipment/assets commission validates DTO (400 with equipment:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/equipment/assets')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'equipment:manage')
      .send({ facilityId: 'nope', name: 'x', manufacturer: 'x', model: 'x', serial: 'x' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/roster/shifts denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/roster/shifts').expect(403);
  });

  it('/api/v1/roster/shifts denies without roster:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/roster/shifts')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/roster/shifts schedule requires roster:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/roster/shifts')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'roster:read')
      .send({ staffId: 'x', kind: 'day', startsAt: 'x', endsAt: 'x' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/roster/staff create validates DTO (400 with roster:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/roster/staff')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'roster:manage')
      .send({ facilityId: 'nope', displayName: 'x', role: 'astronaut' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/beds denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/beds?facilityId=x').expect(403);
  });

  it('/api/v1/beds denies without bed:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/beds?facilityId=00000000-0000-0000-0000-000000000001')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/beds/assign requires bed:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/beds/assign')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'bed:read')
      .send({ encounterId: 'x', locationId: 'x' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/levels create validates DTO (400 with bed:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/levels')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'bed:manage')
      .send({ encounterId: 'nope', level: 'spacestation', reason: 'x' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/research/studies denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/research/studies').expect(403);
  });

  it('/api/v1/research/studies denies without research:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/research/studies')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/research/studies create requires research:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/research/studies')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'research:read')
      .send({ facilityId: 'x', code: 'x', title: 'x' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/research/studies create validates DTO (400 with research:manage)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/research/studies')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'research:manage')
      .send({ facilityId: 'nope', code: 'ab', title: 'x' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  // APPEND NEW TESTS ABOVE THIS LINE (single describe close below)
  // NOTE: :id params must be valid UUIDv4 (ParseUUIDPipe); all-zero UUIDs 400.

  it('/api/v1/sync/devices/me/heartbeat requires a device token (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/devices/me/heartbeat')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sync:write')
      .send({ pendingOut: 0, pendingIn: 0 })
      .expect(401);
    expect(JSON.stringify(res.body)).toContain('DEVICE_TOKEN_REQUIRED');
  });

  it('/api/v1/sync/feed rejects an unknown device token (401, no fail-open)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/sync/feed')
      .set('x-device-token', 'pdev_not-a-real-token')
      .expect(401);
    expect(JSON.stringify(res.body)).toContain('DEVICE_TOKEN_INVALID');
  });

  it('/api/v1/sync/feed rejects device token + mismatched facility (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/sync/feed')
      .set('x-device-token', 'pulse-dev-device')
      .set('x-facility-id', '00000000-0000-0000-0000-0000000000ff')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('DEVICE_FACILITY_MISMATCH');
  });

  it('/api/v1/sync/devices enroll requires sync:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/devices')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sync:write,sync:read')
      .send({ facilityId: '00000000-0000-0000-0000-000000000002', name: 'Edge A', capabilities: ['*'] })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/sync/devices enroll validates the DTO (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/sync/devices')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'sync:manage')
      .send({ facilityId: 'not-a-uuid', capabilities: [] })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/security/events denies without context (403)', () => {
    return request(app.getHttpServer()).get('/api/v1/security/events').expect(403);
  });

  it('/api/v1/security/detections denies without security:read (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/security/detections')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'patient:read')
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/security/findings intake requires security:manage (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/security/findings')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'security:read')
      .send({ title: 'IDOR on export', severity: 'high', component: 'api/export' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('ACCESS_DENIED');
  });

  it('/api/v1/security/findings intake validates the DTO (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/security/findings')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'security:manage')
      .send({ title: 'x', severity: 'catastrophic', component: '' })
      .expect(400);
    expect(res.body.status).toBe(400);
  });

  it('/api/v1/security/findings/:id/triage rejects a non-UUID id (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/security/findings/not-a-uuid/triage')
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000001')
      .set('x-facility-id', '00000000-0000-0000-0000-000000000002')
      .set('x-demo-privileges', 'security:manage')
      .send({})
      .expect(400);
    expect(res.body.status).toBe(400);
  });
});
