import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
import { KyselyStaffInboxRepository } from '../src/modules/workflow/infrastructure/kysely-staff-inbox.repository.js';
import type { PulseDatabase } from '../src/platform/database/db.types.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'staff inbox HTTP and durable delivery',
  () => {
    let app: INestApplication;
    let db: Kysely<PulseDatabase>;
    let repo: KyselyStaffInboxRepository;
    let org: string, facility: string, otherFacility: string;
    let creator: string, recipient: string, stranger: string;
    const recipientPerson = randomUUID();
    const creatorPerson = randomUUID();
    const strangerPerson = randomUUID();
    let taskId: string, notificationId: string;
    beforeAll(async () => {
      db = new Kysely({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: process.env.DATABASE_URL }),
        }),
      });
      org = (
        await db
          .insertInto('org.organization')
          .values({ name: 'Inbox synthetic group', code: randomUUID() })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      facility = (
        await db
          .insertInto('org.facility')
          .values({
            organization_id: org,
            name: 'Inbox test hospital',
            code: 'INBOX',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      otherFacility = (
        await db
          .insertInto('org.facility')
          .values({
            organization_id: org,
            name: 'Other inbox hospital',
            code: 'OTHER',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('iam.membership')
        .values([
          {
            organization_id: org,
            facility_id: facility,
            person_id: creatorPerson,
            roles: ['admin'],
            privileges: ['task:create'],
          },
          {
            organization_id: org,
            facility_id: facility,
            person_id: recipientPerson,
            roles: ['nurse'],
            privileges: [],
          },
          {
            organization_id: org,
            facility_id: otherFacility,
            person_id: recipientPerson,
            roles: ['nurse'],
            privileges: [],
          },
          {
            organization_id: org,
            facility_id: facility,
            person_id: strangerPerson,
            roles: ['nurse'],
            privileges: [],
          },
        ])
        .execute();
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = configureApp(module.createNestApplication());
      await app.init();
      const auth = app.get(StaffAuthService);
      async function token(personId: string) {
        const loginId = `inbox-${randomUUID()}`,
          secret = randomUUID();
        await auth.register({ personId, loginId, secret });
        return (await auth.login({ loginId, secret })).token;
      }
      creator = await token(creatorPerson);
      recipient = await token(recipientPerson);
      stranger = await token(strangerPerson);
      repo = new KyselyStaffInboxRepository(db);
    });
    afterAll(async () => {
      await app?.close();
      await db?.destroy();
    });
    function get(path: string, token = recipient, fac = facility) {
      return request(app.getHttpServer())
        .get(`/api/v1/workflow/staff/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-facility-id', fac)
        .set('x-tenant-id', org);
    }
    function post(path: string, token = recipient, fac = facility) {
      return request(app.getHttpServer())
        .post(`/api/v1/workflow/staff/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-facility-id', fac)
        .set('x-tenant-id', org);
    }
    it('denies unauthenticated, foreign scope, invalid recipient and missing assignment privileges', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/workflow/staff/notifications')
        .expect(401);
      await get('notifications', recipient, randomUUID()).expect(403);
      await post('tasks')
        .send({ kind: 'Review handover', assigneeId: recipientPerson })
        .expect(403);
      await post('tasks', creator)
        .send({ kind: 'Review handover', assigneeId: randomUUID() })
        .expect(400);
      const rows = await sql<{
        count: string;
      }>`SELECT count(*) FROM workflow.task WHERE facility_id=${facility}::uuid`.execute(
        db,
      );
      expect(Number(rows.rows[0]!.count)).toBe(0);
    });
    it('commits task/event, delivers once across concurrent workers, even after global publication', async () => {
      const created = await post('tasks', creator)
        .send({ kind: 'Review shift handover', assigneeId: recipientPerson })
        .expect(201);
      taskId = created.body.id;
      const audit = await db
        .selectFrom('audit.audit_event')
        .select(['actor_id', 'tenant_id', 'facility_id'])
        .where('resource_id', '=', taskId)
        .where('action', '=', 'task.assign')
        .executeTakeFirstOrThrow();
      expect(audit).toMatchObject({
        actor_id: creatorPerson,
        tenant_id: org,
        facility_id: facility,
      });
      await db
        .updateTable('integration.outbox')
        .set({ published_at: new Date() })
        .where('aggregate_id', '=', taskId)
        .execute();
      await Promise.all([repo.deliverBatch(), repo.deliverBatch()]);
      await repo.deliverBatch();
      const inbox = await get('notifications').expect(200);
      expect(inbox.body.items).toHaveLength(1);
      expect(inbox.body.unreadCount).toBe(1);
      expect(inbox.body.items[0]).toMatchObject({
        taskId,
        title: 'A task has been assigned to you',
        readAt: null,
      });
      notificationId = inbox.body.items[0].id;
      const events = await db
        .selectFrom('integration.outbox')
        .select('id')
        .where('aggregate_id', '=', taskId)
        .execute();
      expect(events).toHaveLength(1);
    });
    it('isolates recipients, facilities and task destinations; read is idempotent and never completes a task', async () => {
      expect(
        (await get('notifications', stranger).expect(200)).body.items,
      ).toHaveLength(0);
      expect(
        (await get('notifications', recipient, otherFacility).expect(200)).body
          .items,
      ).toHaveLength(0);
      await post(`notifications/${notificationId}/read`, stranger).expect(404);
      await get(`tasks/${taskId}`, stranger).expect(404);
      await get(`tasks/${taskId}`, recipient, otherFacility).expect(404);
      await post(`notifications/${notificationId}/read`).expect(201);
      const first = (await get('notifications').expect(200)).body.items[0]
        .readAt;
      await post(`notifications/${notificationId}/read`).expect(201);
      const inbox = (await get('notifications').expect(200)).body;
      expect(inbox.unreadCount).toBe(0);
      expect(inbox.items[0].readAt).toBe(first);
      expect(
        (await get('notifications?unread=true').expect(200)).body.items,
      ).toHaveLength(0);
      expect((await get(`tasks/${taskId}`).expect(200)).body.status).toBe(
        'open',
      );
    });
    it('paginates without duplicate rows and rejects malformed cursors', async () => {
      for (let index = 0; index < 21; index++)
        await repo.createAssigned(
          {
            personId: creatorPerson,
            organizationId: org,
            facilityId: facility,
          },
          { kind: `Operational task ${index}`, assigneeId: recipientPerson },
        );
      await repo.deliverBatch();
      const first = (await get('notifications').expect(200)).body;
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toBeTruthy();
      const next = (
        await get(`notifications?cursor=${first.nextCursor}`).expect(200)
      ).body;
      expect(next.items).toHaveLength(2);
      expect(next.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...next.items].map((item) => item.id)).size,
      ).toBe(22);
      await get('notifications?cursor=bad').expect(400);
    });
    it('revoked membership blocks inbox and task access immediately', async () => {
      await db
        .updateTable('iam.membership')
        .set({ effective_to: new Date(0) })
        .where('person_id', '=', recipientPerson)
        .where('facility_id', '=', facility)
        .execute();
      await get('notifications').expect(403);
      await post(`notifications/${notificationId}/read`).expect(403);
      await get(`tasks/${taskId}`).expect(403);
    });
  },
);
