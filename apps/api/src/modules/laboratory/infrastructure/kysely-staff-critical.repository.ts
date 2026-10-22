import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  StaffCriticalCase,
  StaffCriticalDetail,
  StaffCriticalNotify,
  StaffCriticalAttempt,
  StaffCriticalAck,
  StaffCriticalBackup,
  StaffLabResult,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { StaffCriticalRepository } from '../domain/staff-critical.repository.js';
type Db = Kysely<PulseDatabase> | Transaction<PulseDatabase>;
@Injectable()
export class KyselyStaffCriticalRepository implements StaffCriticalRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  private duty(s: PatientReadScope) {
    return (
      s.privileges.includes('lab:worklist') &&
      (s.privileges.includes('lab:verify') ||
        s.privileges.includes('lab:result'))
    );
  }
  private require(s: PatientReadScope, write = false) {
    if (
      !s.privileges.includes('lab:read') ||
      (write
        ? !s.privileges.includes('lab:verify') || !this.duty(s)
        : !this.duty(s) && !s.privileges.includes('lab:critical:ack'))
    )
      throw new ForbiddenException(
        'Critical laboratory follow-up is unavailable for your account.',
      );
  }
  private care(
    person: string,
    patient: ReturnType<typeof sql>,
    facility: string,
  ) {
    return sql`EXISTS(SELECT 1 FROM iam.care_assignment ca WHERE ca.person_id=${person}::uuid AND ca.patient_id=${patient} AND ca.facility_id=${facility}::uuid AND ca.effective_from<=now() AND(ca.effective_to IS NULL OR ca.effective_to>now()))`;
  }
  private from(s: PatientReadScope) {
    return sql`FROM lab.critical_case c JOIN lab.lab_order r ON r.id=c.order_id JOIN patient.patient p ON p.id=r.patient_id AND p.facility_id=c.facility_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id JOIN lab.test t ON t.id=r.test_id AND t.version=r.test_version JOIN org.facility f ON f.id=p.facility_id AND f.organization_id=${s.organizationId}::uuid`;
  }
  private allowed(s: PatientReadScope) {
    return sql`c.facility_id=${s.facilityId}::uuid AND ${this.duty(s) ? sql`true` : sql`(c.recipient_id=${s.personId}::uuid OR EXISTS(SELECT 1 FROM lab.critical_backup b WHERE b.order_id=c.order_id AND b.recipient_id=${s.personId}::uuid AND b.status='active')) AND ${this.care(s.personId, sql`p.id`, s.facilityId)}`}`;
  }
  private projection() {
    return sql`c.order_id AS "orderId",c.version,c.order_version AS "orderVersion",c.recipient_id AS "recipientId",(SELECT login_id FROM iam.credential WHERE person_id=c.recipient_id ORDER BY created_at DESC LIMIT 1) AS "recipientLabel",c.confirmed_by AS "confirmedBy",(SELECT login_id FROM iam.credential WHERE person_id=c.confirmed_by ORDER BY created_at DESC LIMIT 1) AS "confirmedByLabel",c.created_at::text AS "createdAt",c.due_at::text AS "dueAt",c.acknowledged_by AS "acknowledgedBy",c.acknowledged_at::text AS "acknowledgedAt",r.status,COALESCE((SELECT jsonb_agg(COALESCE((SELECT login_id FROM iam.credential cr WHERE cr.person_id=b.recipient_id ORDER BY cr.created_at DESC LIMIT 1),'Named covering clinician')) FROM lab.critical_backup b WHERE b.order_id=c.order_id AND b.status='active'),'[]'::jsonb) AS "coveringLabels",t.name AS "testName",jsonb_build_object('id',p.id,'name',p.given_name||' '||p.family_name,'mrn',(SELECT value FROM patient.identifier WHERE patient_id=p.id AND facility_id=p.facility_id AND system='urn:pulse:mrn:'||p.facility_id::text ORDER BY created_at,id LIMIT 1)) AS patient`;
  }
  private async audit(s: PatientReadScope, id: string, action: string) {
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${s.personId}::uuid,'staff',${action},'lab_order',${id}::uuid,${s.organizationId}::uuid,${s.facilityId}::uuid)`.execute(
      this.db,
    );
  }
  async count(s: PatientReadScope) {
    this.require(s);
    return (
      await sql<{
        pending: number;
        overdue: number;
      }>`SELECT count(*)::int AS pending,count(*)FILTER(WHERE c.due_at<now())::int AS overdue ${this.from(s)} WHERE ${this.allowed(s)} AND c.acknowledged_at IS NULL`.execute(
        this.db,
      )
    ).rows[0]!;
  }
  async queue(s: PatientReadScope, cursor?: string) {
    this.require(s);
    if (
      cursor &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        cursor,
      )
    )
      throw new BadRequestException('Invalid critical follow-up page.');
    const rows = (
      await sql<StaffCriticalCase>`SELECT ${this.projection()} ${this.from(s)} WHERE ${this.allowed(s)} AND c.acknowledged_at IS NULL ${cursor ? sql`AND c.order_id>${cursor}::uuid` : sql``} ORDER BY c.order_id LIMIT 26`.execute(
        this.db,
      )
    ).rows;
    await this.audit(s, s.facilityId, 'lab.critical_queue_read');
    return {
      items: rows.slice(0, 25),
      nextCursor: rows.length > 25 ? rows[24]!.orderId : null,
    };
  }
  private async order(db: Db, s: PatientReadScope, id: string, lock = false) {
    const r = (
      await sql<{
        patientId: string;
        version: number;
        status: string;
      }>`SELECT r.patient_id AS "patientId",r.version,r.status FROM lab.lab_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id JOIN org.facility f ON f.id=p.facility_id WHERE r.id=${id}::uuid AND p.facility_id=${s.facilityId}::uuid AND f.organization_id=${s.organizationId}::uuid ${lock ? sql`FOR UPDATE OF r` : sql``}`.execute(
        db,
      )
    ).rows[0];
    if (!r)
      throw new NotFoundException(
        'Critical laboratory request is unavailable.',
      );
    return r;
  }
  private async results(db: Db, id: string) {
    return (
      await sql<StaffLabResult>`SELECT DISTINCT ON(lower(btrim(component))) id,component,value_text AS value,unit,flag,version,created_at::text AS "recordedAt",recorded_by AS "recordedBy",effective_at::text AS "effectiveAt",source,(SELECT login_id FROM iam.credential WHERE person_id=v.recorded_by ORDER BY created_at DESC LIMIT 1) AS "recordedByLabel" FROM lab.result v WHERE order_id=${id}::uuid ORDER BY lower(btrim(component)),version DESC,created_at DESC,id DESC`.execute(
        db,
      )
    ).rows;
  }
  async get(s: PatientReadScope, id: string): Promise<StaffCriticalDetail> {
    this.require(s);
    await this.order(this.db, s, id);
    const c =
      (
        await sql<StaffCriticalCase>`SELECT ${this.projection()} ${this.from(s)} WHERE r.id=${id}::uuid AND ${this.allowed(s)}`.execute(
          this.db,
        )
      ).rows[0] ?? null;
    if (!c && !this.duty(s))
      throw new NotFoundException('Critical follow-up is unavailable.');
    const contacts = c
      ? (
          await sql<
            StaffCriticalDetail['contacts'][number]
          >`SELECT id,recipient_id AS "recipientId",(SELECT login_id FROM iam.credential WHERE person_id=a.recipient_id ORDER BY created_at DESC LIMIT 1) AS "recipientLabel",actor_id AS "actorId",channel,outcome,read_back AS "readBack",occurred_at::text AS "occurredAt",(SELECT login_id FROM iam.credential WHERE person_id=a.actor_id ORDER BY created_at DESC LIMIT 1) AS "actorLabel" FROM lab.critical_contact a WHERE order_id=${id}::uuid ORDER BY occurred_at,id`.execute(
            this.db,
          )
        ).rows
      : [];
    const backups = c
      ? (
          await sql<
            StaffCriticalDetail['backups'][number]
          >`SELECT b.id,b.recipient_id AS "recipientId",(SELECT login_id FROM iam.credential WHERE person_id=b.recipient_id ORDER BY created_at DESC LIMIT 1) AS "recipientLabel",(SELECT login_id FROM iam.credential WHERE person_id=b.configured_by ORDER BY created_at DESC LIMIT 1) AS "configuredByLabel",b.reason,b.mode,b.status,b.created_at::text AS "createdAt",b.activated_at::text AS "activatedAt",b.decided_at::text AS "decidedAt",b.decision FROM lab.critical_backup b WHERE b.order_id=${id}::uuid ORDER BY b.created_at,b.id`.execute(
            this.db,
          )
        ).rows
      : [];
    await this.audit(s, id, 'lab.critical_detail_read');
    return {
      case: c,
      canAcknowledge: Boolean(
        c &&
        (c.recipientId === s.personId ||
          backups.some(
            (b) => b.recipientId === s.personId && b.status === 'active',
          )) &&
        s.privileges.includes('lab:critical:ack'),
      ),
      results: await this.results(this.db, id),
      contacts,
      backups,
      readBackConfirmed: contacts.some(
        (a) =>
          a.recipientId === s.personId && a.outcome === 'reached' && a.readBack,
      ),
    };
  }
  private recipientPredicate(s: PatientReadScope, patientId: string) {
    return sql`m.facility_id=${s.facilityId}::uuid AND m.organization_id=${s.organizationId}::uuid AND(m.effective_from IS NULL OR m.effective_from<=now())AND(m.effective_to IS NULL OR m.effective_to>now()) AND m.privileges @> ARRAY['patient:read','lab:read','lab:critical:ack']::text[] AND EXISTS(SELECT 1 FROM iam.credential cr WHERE cr.person_id=m.person_id AND cr.status='active') AND EXISTS(SELECT 1 FROM iam.care_assignment ca WHERE ca.person_id=m.person_id AND ca.patient_id=${patientId}::uuid AND ca.facility_id=m.facility_id AND ca.effective_from<=now()AND(ca.effective_to IS NULL OR ca.effective_to>now()))`;
  }
  async recipients(s: PatientReadScope, id: string) {
    this.require(s, true);
    const r = await this.order(this.db, s, id);
    return (
      await sql<{
        id: string;
        label: string;
      }>`SELECT DISTINCT m.person_id AS id,(SELECT login_id FROM iam.credential WHERE person_id=m.person_id AND status='active' ORDER BY created_at DESC LIMIT 1) AS label FROM iam.membership m WHERE ${this.recipientPredicate(s, r.patientId)} ORDER BY label,id LIMIT 100`.execute(
        this.db,
      )
    ).rows;
  }
  private changed(): never {
    throw new ConflictException({
      code: 'LAB_CRITICAL_CHANGED',
      message:
        'This critical follow-up has changed. Reopen it to review the latest evidence.',
    });
  }
  async notify(s: PatientReadScope, id: string, input: StaffCriticalNotify) {
    this.require(s, true);
    await staffCommand(
      this.db,
      s,
      input.commandKey,
      'lab.critical_notified',
      { id, ...input },
      async (trx) => {
        if (
          input.attestation !== true ||
          !Number.isFinite(Date.parse(input.dueAt)) ||
          Date.parse(input.dueAt) <= Date.now()
        )
          throw new BadRequestException(
            'Confirm the finding and choose a future follow-up time according to facility policy.',
          );
        const order = await this.order(trx, s, id, true);
        if (
          order.status !== 'resulted' ||
          order.version !== input.expectedVersion
        )
          this.changed();
        const rows = await this.results(trx, id);
        if (
          !rows.some((r) => r.flag === 'critical') ||
          rows.some(
            (r) =>
              !r.recordedBy || !r.effectiveAt || r.source !== 'manual-bench',
          )
        )
          this.changed();
        if (rows.some((r) => r.recordedBy === s.personId))
          throw new ForbiddenException(
            'A separate authorised verifier must confirm the critical finding.',
          );
        const recipient =
          await sql`SELECT m.id FROM iam.membership m WHERE m.person_id=${input.recipientId}::uuid AND ${this.recipientPredicate(s, order.patientId)} FOR SHARE OF m`.execute(
            trx,
          );
        if (!recipient.rows.length)
          throw new BadRequestException(
            'Select an active authorised clinician with current patient care responsibility.',
          );
        if (
          (
            await sql`SELECT order_id FROM lab.critical_case WHERE order_id=${id}::uuid`.execute(
              trx,
            )
          ).rows.length
        )
          this.changed();
        await sql`INSERT INTO lab.critical_case(order_id,facility_id,recipient_id,confirmed_by,order_version,due_at)VALUES(${id}::uuid,${s.facilityId}::uuid,${input.recipientId}::uuid,${s.personId}::uuid,${order.version},${input.dueAt}::timestamptz)`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          s,
          'lab_order',
          id,
          'lab.critical_notified',
          {
            patientId: order.patientId,
            recipientId: input.recipientId,
            version: 1,
          },
        );
        return { id };
      },
    );
    return this.get(s, id);
  }
  async attempt(s: PatientReadScope, id: string, input: StaffCriticalAttempt) {
    this.require(s, true);
    if (
      !['phone', 'in-person'].includes(input.channel) ||
      !['reached', 'unreachable'].includes(input.outcome) ||
      input.readBack !== (input.outcome === 'reached')
    )
      throw new BadRequestException(
        'Record the contact outcome and confirm read-back when reached.',
      );
    await staffCommand(
      this.db,
      s,
      input.commandKey,
      'lab.critical_contact',
      { id, ...input },
      async (trx) => {
        await this.order(trx, s, id, true);
        const c = (
          await sql<{
            version: number;
            created_at: Date;
            acknowledged_at: Date | null;
            recipient_id: string;
          }>`SELECT version,created_at,acknowledged_at,recipient_id FROM lab.critical_case WHERE order_id=${id}::uuid FOR UPDATE`.execute(
            trx,
          )
        ).rows[0];
        if (!c || c.version !== input.expectedVersion || c.acknowledged_at)
          this.changed();
        const recipient = input.recipientId ?? c.recipient_id;
        if (
          recipient !== c.recipient_id &&
          !(
            await sql`SELECT id FROM lab.critical_backup WHERE order_id=${id}::uuid AND recipient_id=${recipient}::uuid AND status='active'`.execute(
              trx,
            )
          ).rows.length
        )
          throw new BadRequestException(
            'Select an active named recipient for this contact.',
          );
        const at = Date.parse(input.occurredAt);
        if (
          !Number.isFinite(at) ||
          at < c.created_at.getTime() ||
          at > Date.now() + 60000
        )
          throw new BadRequestException(
            'Record an actual contact time after the case was opened and no later than now.',
          );
        await sql`INSERT INTO lab.critical_contact(order_id,recipient_id,actor_id,channel,outcome,read_back,occurred_at)VALUES(${id}::uuid,${recipient}::uuid,${s.personId}::uuid,${input.channel},${input.outcome},${input.readBack},${input.occurredAt}::timestamptz)`.execute(
          trx,
        );
        await sql`UPDATE lab.critical_case SET version=version+1 WHERE order_id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(trx, s, 'lab_order', id, 'lab.critical_contact', {
          version: c.version + 1,
          outcome: input.outcome,
        });
        return { id };
      },
    );
    return this.get(s, id);
  }
  async backup(s: PatientReadScope, id: string, input: StaffCriticalBackup) {
    this.require(s, true);
    const reason = input.reason.trim();
    if (
      reason.length < 5 ||
      reason.length > 1000 ||
      input.attestation !== true ||
      !['immediate', 'at-deadline'].includes(input.mode)
    )
      throw new BadRequestException(
        'Review the covering clinician, activation and reason.',
      );
    await staffCommand(
      this.db,
      s,
      input.commandKey,
      'lab.critical_backup_configured',
      { id, ...input },
      async (trx) => {
        const order = await this.order(trx, s, id, true);
        const c = (
          await sql<{
            version: number;
            recipient_id: string;
            due_at: Date;
            acknowledged_at: Date | null;
          }>`SELECT version,recipient_id,due_at,acknowledged_at FROM lab.critical_case WHERE order_id=${id}::uuid FOR UPDATE`.execute(
            trx,
          )
        ).rows[0];
        if (!c || c.version !== input.expectedVersion || c.acknowledged_at)
          this.changed();
        if (input.recipientId === c.recipient_id)
          throw new BadRequestException(
            'Select a different covering clinician. The original assignment is retained.',
          );
        if (input.mode === 'at-deadline' && c.due_at.getTime() <= Date.now())
          throw new BadRequestException(
            'The follow-up time has passed. Use immediate escalation.',
          );
        const eligible =
          await sql`SELECT m.id FROM iam.membership m WHERE m.person_id=${input.recipientId}::uuid AND ${this.recipientPredicate(s, order.patientId)} FOR SHARE OF m`.execute(
            trx,
          );
        if (!eligible.rows.length)
          throw new BadRequestException(
            'The covering clinician needs active facility membership and current patient care responsibility.',
          );
        if (
          (
            await sql`SELECT id FROM lab.critical_backup WHERE order_id=${id}::uuid AND recipient_id=${input.recipientId}::uuid`.execute(
              trx,
            )
          ).rows.length
        )
          throw new ConflictException({
            code: 'LAB_CRITICAL_BACKUP_EXISTS',
            message:
              'This clinician already has a routing record. Review that evidence.',
          });
        await sql`INSERT INTO lab.critical_backup(order_id,recipient_id,configured_by,reason,mode,status,activated_at,decided_at,decision)VALUES(${id}::uuid,${input.recipientId}::uuid,${s.personId}::uuid,${reason},${input.mode},${input.mode === 'immediate' ? 'active' : 'scheduled'},${input.mode === 'immediate' ? sql`clock_timestamp()` : sql`NULL`},${input.mode === 'immediate' ? sql`clock_timestamp()` : sql`NULL`},${input.mode === 'immediate' ? 'manual-escalation' : null})`.execute(
          trx,
        );
        await sql`UPDATE lab.critical_case SET version=version+1 WHERE order_id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          s,
          'lab_order',
          id,
          'lab.critical_backup_configured',
          {
            recipientId: input.recipientId,
            mode: input.mode,
            version: c.version + 1,
          },
        );
        return { id };
      },
    );
    return this.get(s, id);
  }
  /** Durable polling: no ownership/PHI is inferred from role names. */
  async processDue() {
    const due = (
      await sql<{
        order_id: string;
      }>`SELECT DISTINCT b.order_id FROM lab.critical_backup b JOIN lab.critical_case c ON c.order_id=b.order_id WHERE b.status='scheduled' AND (c.acknowledged_at IS NOT NULL OR c.due_at<=clock_timestamp()) ORDER BY b.order_id LIMIT 25`.execute(
        this.db,
      )
    ).rows;
    let processed = 0;
    for (const item of due) {
      processed += await this.db.transaction().execute(async (trx) => {
        const lock =
          await sql`SELECT id FROM lab.lab_order WHERE id=${item.order_id}::uuid FOR UPDATE SKIP LOCKED`.execute(
            trx,
          );
        if (!lock.rows.length) return 0;
        const c = (
          await sql<{
            facility_id: string;
            organization_id: string;
            patient_id: string;
            due_at: Date;
            acknowledged_at: Date | null;
            version: number;
          }>`SELECT c.facility_id,f.organization_id,r.patient_id,c.due_at,c.acknowledged_at,c.version FROM lab.critical_case c JOIN lab.lab_order r ON r.id=c.order_id JOIN patient.patient p ON p.id=r.patient_id AND p.facility_id=c.facility_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id JOIN org.facility f ON f.id=c.facility_id WHERE c.order_id=${item.order_id}::uuid FOR UPDATE OF c`.execute(
            trx,
          )
        ).rows[0];
        if (!c) return 0;
        const backups = (
          await sql<{
            id: string;
            recipient_id: string;
            configured_by: string;
          }>`SELECT id,recipient_id,configured_by FROM lab.critical_backup WHERE order_id=${item.order_id}::uuid AND status='scheduled' FOR UPDATE`.execute(
            trx,
          )
        ).rows;
        let count = 0;
        for (const b of backups) {
          const scope: PatientReadScope = {
            personId: b.configured_by,
            organizationId: c.organization_id,
            facilityId: c.facility_id,
            privileges: [],
          };
          const eligible =
            await sql`SELECT m.id FROM iam.membership m WHERE m.person_id=${b.recipient_id}::uuid AND ${this.recipientPredicate(scope, c.patient_id)} FOR SHARE OF m`.execute(
              trx,
            );
          if (!c.acknowledged_at && c.due_at.getTime() > Date.now()) continue;
          const status = c.acknowledged_at
            ? 'cancelled'
            : eligible.rows.length
              ? 'active'
              : 'blocked';
          const decision = c.acknowledged_at
            ? 'case-acknowledged'
            : eligible.rows.length
              ? 'deadline-reached'
              : 'recipient-access-unavailable';
          await sql`UPDATE lab.critical_backup SET status=${status},activated_at=${status === 'active' ? sql`clock_timestamp()` : sql`NULL`},decided_at=clock_timestamp(),decision=${decision} WHERE id=${b.id}::uuid`.execute(
            trx,
          );
          const payload = JSON.stringify({
            id: item.order_id,
            facilityId: c.facility_id,
            backupId: b.id,
            recipientId: b.recipient_id,
            status,
            decision,
          });
          await sql`INSERT INTO integration.outbox(aggregate_type,aggregate_id,type,version,producer,payload)VALUES('lab_order',${item.order_id}::uuid,'lab.critical_backup_decided',1,'laboratory',${payload}::jsonb)`.execute(
            trx,
          );
          await sql`INSERT INTO audit.audit_event(actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)VALUES('system','lab.critical_backup_decided','lab_order',${item.order_id}::uuid,${c.organization_id}::uuid,${c.facility_id}::uuid,${payload}::jsonb)`.execute(
            trx,
          );
          count++;
        }
        if (count)
          await sql`UPDATE lab.critical_case SET version=version+1 WHERE order_id=${item.order_id}::uuid`.execute(
            trx,
          );
        return count;
      });
    }
    return processed;
  }
  async acknowledge(s: PatientReadScope, id: string, input: StaffCriticalAck) {
    this.require(s);
    if (
      !s.privileges.includes('lab:critical:ack') ||
      input.attestation !== true
    )
      throw new ForbiddenException(
        'Explicit clinician acknowledgement is required.',
      );
    await staffCommand(
      this.db,
      s,
      input.commandKey,
      'lab.critical_acknowledged',
      { id, ...input },
      async (trx) => {
        const order = await this.order(trx, s, id, true);
        const c = (
          await sql<{
            version: number;
            recipient_id: string;
            acknowledged_at: Date | null;
          }>`SELECT version,recipient_id,acknowledged_at FROM lab.critical_case WHERE order_id=${id}::uuid FOR UPDATE`.execute(
            trx,
          )
        ).rows[0];
        if (
          !c ||
          (c.recipient_id !== s.personId &&
            !(
              await sql`SELECT id FROM lab.critical_backup WHERE order_id=${id}::uuid AND recipient_id=${s.personId}::uuid AND status='active'`.execute(
                trx,
              )
            ).rows.length)
        )
          throw new NotFoundException(
            'This critical follow-up is not assigned to you.',
          );
        if (
          !(
            await sql`SELECT m.id FROM iam.membership m WHERE m.person_id=${s.personId}::uuid AND ${this.recipientPredicate(s, order.patientId)} FOR SHARE OF m`.execute(
              trx,
            )
          ).rows.length
        )
          throw new ForbiddenException(
            'Current patient care responsibility is required.',
          );
        if (c.version !== input.expectedVersion || c.acknowledged_at)
          this.changed();
        if (
          !(
            await sql`SELECT id FROM lab.critical_contact WHERE order_id=${id}::uuid AND recipient_id=${s.personId}::uuid AND outcome='reached' AND read_back LIMIT 1`.execute(
              trx,
            )
          ).rows.length
        )
          throw new ConflictException({
            code: 'LAB_CRITICAL_CONTACT_REQUIRED',
            message:
              'Laboratory staff must record completed communication and read-back first.',
          });
        await sql`UPDATE lab.critical_case SET acknowledged_by=${s.personId}::uuid,acknowledged_at=clock_timestamp(),version=version+1 WHERE order_id=${id}::uuid`.execute(
          trx,
        );
        await sql`UPDATE lab.lab_order SET critical_ack_by=${s.personId}::uuid,critical_ack_at=clock_timestamp() WHERE id=${id}::uuid`.execute(
          trx,
        );
        await sql`UPDATE lab.critical_backup SET status='cancelled',decided_at=clock_timestamp(),decision='case-acknowledged' WHERE order_id=${id}::uuid AND status='scheduled'`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          s,
          'lab_order',
          id,
          'lab.critical_acknowledged',
          {
            patientId: order.patientId,
            recipientId: s.personId,
            version: c.version + 1,
          },
        );
        return { id };
      },
    );
    return this.get(s, id);
  }
}
