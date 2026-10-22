import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  InboxScope,
  InboxPage,
  StaffInboxRepository,
  AssignedTask,
} from '../domain/staff-inbox.repository.js';

@Injectable()
export class KyselyStaffInboxRepository implements StaffInboxRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async list(
    scope: InboxScope,
    unreadOnly: boolean,
    cursor?: string,
  ): Promise<InboxPage> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const after = cursor
          ? (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
              at: string;
              id: string;
            })
          : null;
        const rows = await sql<{
          id: string;
          task_id: string;
          created_at: Date;
          cursor_at: string;
          read_at: Date | null;
        }>`
        SELECT n.id,n.task_id,n.created_at,n.read_at,to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM workflow.staff_notification n
        JOIN workflow.task t ON t.id=n.task_id AND t.facility_id=n.facility_id AND t.assigned_person_id=n.recipient_person_id
        WHERE n.recipient_person_id=${scope.personId}::uuid AND n.facility_id=${scope.facilityId}::uuid
          AND n.organization_id=${scope.organizationId}::uuid
          ${unreadOnly ? sql`AND n.read_at IS NULL` : sql``}
          ${after ? sql`AND (n.created_at,n.id)<(${after.at}::timestamptz,${after.id}::uuid)` : sql``}
        ORDER BY n.created_at DESC,n.id DESC LIMIT 21`.execute(trx);
        const count = await sql<{
          count: string;
        }>`SELECT count(*) FROM workflow.staff_notification n
        JOIN workflow.task t ON t.id=n.task_id AND t.facility_id=n.facility_id AND t.assigned_person_id=n.recipient_person_id
        WHERE n.recipient_person_id=${scope.personId}::uuid AND n.facility_id=${scope.facilityId}::uuid
        AND n.organization_id=${scope.organizationId}::uuid AND n.read_at IS NULL`.execute(
          trx,
        );
        const page = rows.rows.slice(0, 20);
        const last = page.at(-1);
        return {
          items: page.map((row) => ({
            id: row.id,
            taskId: row.task_id,
            category: 'task',
            priority: 'normal',
            title: 'A task has been assigned to you',
            createdAt: row.created_at.toISOString(),
            readAt: row.read_at?.toISOString() ?? null,
          })),
          unreadCount: Number(count.rows[0]?.count ?? 0),
          nextCursor:
            rows.rows.length > 20 && last
              ? Buffer.from(
                  JSON.stringify({ at: last.cursor_at, id: last.id }),
                ).toString('base64url')
              : null,
        };
      });
  }
  async read(scope: InboxScope, id: string) {
    const result =
      await sql`UPDATE workflow.staff_notification n SET read_at=COALESCE(read_at,now())
      WHERE n.id=${id}::uuid AND n.recipient_person_id=${scope.personId}::uuid
      AND n.facility_id=${scope.facilityId}::uuid AND n.organization_id=${scope.organizationId}::uuid
      AND EXISTS(SELECT 1 FROM workflow.task t WHERE t.id=n.task_id AND t.facility_id=n.facility_id AND t.assigned_person_id=n.recipient_person_id)
      RETURNING n.id`.execute(this.db);
    return result.rows.length === 1;
  }
  async createAssigned(
    scope: InboxScope,
    input: { kind: string; assigneeId: string },
  ) {
    return this.db.transaction().execute(async (trx) => {
      const member =
        await sql`SELECT m.id FROM iam.membership m JOIN org.facility f ON f.id=m.facility_id AND f.organization_id=m.organization_id
        WHERE m.person_id=${input.assigneeId}::uuid AND m.facility_id=${scope.facilityId}::uuid AND m.organization_id=${scope.organizationId}::uuid
        AND (m.effective_from IS NULL OR m.effective_from<=now()) AND (m.effective_to IS NULL OR m.effective_to>now())
        AND EXISTS(SELECT 1 FROM iam.credential c WHERE c.person_id=m.person_id AND c.status='active') LIMIT 1`.execute(
          trx,
        );
      if (!member.rows.length)
        throw new BadRequestException({
          code: 'TASK_RECIPIENT_INVALID',
          message: 'Select an active staff member in this facility',
        });
      const task = await sql<{
        id: string;
      }>`INSERT INTO workflow.task(kind,facility_id,assigned_person_id,created_by)
        VALUES(${input.kind},${scope.facilityId}::uuid,${input.assigneeId}::uuid,${scope.personId}::uuid) RETURNING id`.execute(
        trx,
      );
      const id = task.rows[0]!.id;
      await trx
        .insertInto('integration.outbox')
        .values({
          aggregate_type: 'task',
          aggregate_id: id,
          type: 'workflow.task.assigned',
          version: 1,
          producer: 'workflow',
          payload: JSON.stringify({
            taskId: id,
            recipientPersonId: input.assigneeId,
          }),
        })
        .execute();
      await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)
        VALUES(${scope.personId}::uuid,'staff','task.assign','task',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid,
          ${JSON.stringify({ assigneeId: input.assigneeId })}::jsonb)`.execute(
        trx,
      );
      return { id };
    });
  }
  async task(scope: InboxScope, id: string): Promise<AssignedTask | undefined> {
    const result = await sql<{
      id: string;
      kind: string;
      status: string;
      created_at: Date;
    }>`SELECT id,kind,status,created_at FROM workflow.task
      WHERE id=${id}::uuid AND facility_id=${scope.facilityId}::uuid AND assigned_person_id=${scope.personId}::uuid AND patient_id IS NULL`.execute(
      this.db,
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          kind: row.kind,
          status: row.status,
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }
  async deliverBatch() {
    return this.db.transaction().execute(async (trx) => {
      const events = await sql<{
        id: string;
        aggregate_id: string;
        recipient: string | null;
      }>`SELECT e.id,e.aggregate_id,e.payload->>'recipientPersonId' AS recipient
        FROM integration.outbox e WHERE e.type='workflow.task.assigned' AND e.producer='workflow' AND e.version=1
        AND NOT EXISTS(SELECT 1 FROM workflow.staff_notification_delivery d WHERE d.event_id=e.id)
        ORDER BY e.created_at,e.id LIMIT 50 FOR UPDATE OF e SKIP LOCKED`.execute(
        trx,
      );
      for (const event of events.rows) {
        const inserted =
          await sql`INSERT INTO workflow.staff_notification(organization_id,facility_id,recipient_person_id,event_id,task_id)
          SELECT f.organization_id,t.facility_id,t.assigned_person_id,${event.id}::uuid,t.id
          FROM workflow.task t JOIN org.facility f ON f.id=t.facility_id
          WHERE t.id=${event.aggregate_id}::uuid AND t.assigned_person_id::text=${event.recipient} AND t.patient_id IS NULL
          AND EXISTS(SELECT 1 FROM iam.membership m WHERE m.person_id=t.assigned_person_id AND m.facility_id=t.facility_id AND m.organization_id=f.organization_id
            AND (m.effective_from IS NULL OR m.effective_from<=now()) AND (m.effective_to IS NULL OR m.effective_to>now()))
          AND EXISTS(SELECT 1 FROM iam.credential c WHERE c.person_id=t.assigned_person_id AND c.status='active')
          ON CONFLICT(event_id,recipient_person_id) DO NOTHING RETURNING id`.execute(
            trx,
          );
        await sql`INSERT INTO workflow.staff_notification_delivery(event_id,outcome) VALUES(${event.id}::uuid,${inserted.rows.length ? 'delivered' : 'recipient_unavailable'}) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
      }
      return events.rows.length;
    });
  }
}
