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
  StaffImagingProcedure,
  StaffImagingOrder,
  StaffImagingOrderInput,
  StaffLabCancellation,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { StaffImagingRepository } from '../domain/staff-imaging.repository.js';
@Injectable()
export class KyselyStaffImagingRepository implements StaffImagingRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  private require(
    scope: PatientReadScope,
    action?: 'imaging:order' | 'imaging:cancel',
  ) {
    if (
      !scope.privileges.includes('imaging:view') ||
      (action &&
        (!scope.privileges.includes(action) ||
          !scope.privileges.includes('encounter:consult')))
    )
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'This imaging action is unavailable for your account.',
      });
  }
  private patient(scope: PatientReadScope, patientId: string) {
    return sql`p.id=${patientId}::uuid AND p.facility_id=${scope.facilityId}::uuid
    AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)
    AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=p.facility_id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))`;
  }
  private eligible(scope: PatientReadScope, patientId: string) {
    return sql`${this.patient(scope, patientId)} AND p.status='active' AND e.status IN ('open','admitted')
    AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=p.facility_id AND a.encounter_id=e.id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))
    AND (e.type IN ('inpatient','emergency') OR (e.type='outpatient' AND EXISTS(SELECT 1 FROM encounter.outpatient_visit v WHERE v.encounter_id=e.id AND v.patient_id=p.id AND v.facility_id=p.facility_id AND v.stage='in-consultation' AND v.clinician_person_id=${scope.personId}::uuid)))`;
  }
  async contexts(scope: PatientReadScope, patientId: string) {
    this.require(scope, 'imaging:order');
    const rows = (
      await sql<{
        id: string;
        type: string;
        started_at: Date;
      }>`SELECT e.id,e.type,e.started_at FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE ${this.eligible(scope, patientId)} ORDER BY e.started_at DESC,e.id DESC LIMIT 100`.execute(
        this.db,
      )
    ).rows;
    return rows.map((r) => ({
      encounterId: r.id,
      type: r.type,
      startedAt: r.started_at.toISOString(),
    }));
  }
  private async context(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    patientId: string,
    encounterId: string,
  ) {
    await sql`SELECT id FROM iam.care_assignment WHERE person_id=${scope.personId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND encounter_id=${encounterId}::uuid FOR SHARE`.execute(
      trx,
    );
    await sql`SELECT encounter_id FROM encounter.outpatient_visit WHERE encounter_id=${encounterId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid FOR SHARE`.execute(
      trx,
    );
    const rows =
      await sql`SELECT e.id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE e.id=${encounterId}::uuid AND ${this.eligible(scope, patientId)} FOR SHARE OF e,p`.execute(
        trx,
      );
    if (!rows.rows.length)
      throw new ForbiddenException({
        code: 'IMAGING_ENCOUNTER_NOT_ASSIGNED',
        message:
          'An active encounter assigned to the treating clinician is required.',
      });
  }
  private available(scope: PatientReadScope) {
    return sql`t.active AND ft.active AND ft.facility_id=${scope.facilityId}::uuid AND NOT EXISTS(
    SELECT 1 FROM img.procedure newer JOIN img.facility_procedure nf ON nf.procedure_id=newer.id AND nf.facility_id=ft.facility_id AND nf.active WHERE newer.code=t.code AND newer.version>t.version AND newer.active)`;
  }
  async catalogue(scope: PatientReadScope, patientId: string, query: string) {
    this.require(scope, 'imaging:order');
    const q = query.trim();
    if (q.length > 100 || (q.length > 0 && q.length < 2))
      throw new BadRequestException('Use 2 to 100 search characters.');
    const patient =
      await sql`SELECT p.id FROM patient.patient p WHERE ${this.patient(scope, patientId)}`.execute(
        this.db,
      );
    if (!patient.rows.length)
      throw new NotFoundException(
        'This patient is unavailable in your care context.',
      );
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const items = (
      await sql<StaffImagingProcedure>`SELECT t.id,t.code,t.name,t.instructions,t.modality,t.body_region AS "bodyRegion",t.laterality_policy AS "lateralityPolicy",t.version FROM img.procedure t JOIN img.facility_procedure ft ON ft.procedure_id=t.id WHERE ${this.available(scope)} AND (t.name ILIKE ${pattern} OR t.code ILIKE ${pattern}) ORDER BY lower(t.name),t.code,t.id LIMIT 26`.execute(
        this.db,
      )
    ).rows;
    await this.audit(scope, patientId, 'imaging.catalogue_read');
    return { items: items.slice(0, 25), hasMore: items.length > 25 };
  }
  private async audit(
    scope: PatientReadScope,
    id: string,
    action: string,
    resourceType = 'patient',
  ) {
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff',${action},${resourceType},${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(
      this.db,
    );
  }
  async get(
    scope: PatientReadScope,
    patientId: string,
    id: string,
  ): Promise<StaffImagingOrder> {
    this.require(scope);
    const row = (
      await sql<StaffImagingOrder>`SELECT jsonb_build_object('type',e.type,'startedAt',e.started_at) AS encounter,r.id,r.patient_id AS "patientId",r.encounter_id AS "encounterId",CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'version',r.procedure_version,'instructions',t.instructions,'modality',t.modality,'bodyRegion',t.body_region,'lateralityPolicy',t.laterality_policy) ELSE NULL END AS procedure,r.procedure_code AS "procedureCode",r.body_region AS "bodyRegion",r.laterality,r.safety_context AS "safetyContext",
      r.urgency,r.indication,r.status,r.version,r.ordered_by AS "orderedBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.ordered_by ORDER BY c.created_at DESC LIMIT 1) AS "orderedByLabel",r.created_at::text AS "orderedAt",r.cancel_reason AS "cancelReason",r.cancelled_by AS "cancelledBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.cancelled_by ORDER BY c.created_at DESC LIMIT 1) AS "cancelledByLabel",r.cancelled_at::text AS "cancelledAt"
      FROM img.img_order r LEFT JOIN img.procedure t ON t.id=r.procedure_id AND t.version=r.procedure_version JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id
      WHERE r.id=${id}::uuid AND ${this.patient(scope, patientId)}`.execute(
        this.db,
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: 'IMAGING_ORDER_NOT_FOUND',
        message: 'This order is unavailable in your current care context.',
      });
    await this.audit(scope, id, 'imaging.order_read', 'imaging_order');
    return row;
  }
  async order(
    scope: PatientReadScope,
    patientId: string,
    input: StaffImagingOrderInput,
  ) {
    this.require(scope, 'imaging:order');
    const indication = input.indication.trim();
    if (
      indication.length < 3 ||
      indication.length > 2000 ||
      input.attestation !== true ||
      input.safetyContext.length > 2000
    )
      throw new BadRequestException(
        'Review the request and enter a clinical indication.',
      );
    const result = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'imaging.ordered',
      { patientId, ...input },
      async (trx) => {
        await this.context(trx, scope, patientId, input.encounterId);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`imaging-order/${input.encounterId}`},0))`.execute(
          trx,
        );
        const procedure = (
          await sql<StaffImagingProcedure>`SELECT t.id,t.code,t.name,t.version,t.instructions,t.modality,t.body_region AS "bodyRegion",t.laterality_policy AS "lateralityPolicy" FROM img.procedure t JOIN img.facility_procedure ft ON ft.procedure_id=t.id WHERE t.id=${input.procedureId}::uuid AND t.version=${input.procedureVersion} AND ${this.available(scope)} FOR SHARE OF t,ft`.execute(
            trx,
          )
        ).rows[0];
        if (!procedure)
          throw new ConflictException({
            code: 'IMAGING_CATALOGUE_CHANGED',
            message:
              'The selected procedure or version is no longer available at this facility. Review the catalogue again.',
          });
        if (
          !['left', 'right', 'bilateral', 'na'].includes(input.laterality) ||
          (procedure.lateralityPolicy === 'required' &&
            input.laterality === 'na') ||
          (procedure.lateralityPolicy === 'na' && input.laterality !== 'na')
        )
          throw new BadRequestException({
            code: 'IMAGING_LATERALITY_REQUIRED',
            message: 'Select the side required by the approved procedure.',
          });
        const pending =
          await sql`SELECT r.id FROM img.img_order r WHERE r.patient_id=${patientId}::uuid AND r.encounter_id=${input.encounterId}::uuid AND r.procedure_code=${procedure.code} AND r.status IN ('ordered','scheduled','protocolled','acquired','reported') AND COALESCE(r.laterality,'na')=${input.laterality}`.execute(
            trx,
          );
        if (pending.rows.length)
          throw new ConflictException({
            code: 'IMAGING_ORDER_PENDING',
            message:
              'This encounter already has a pending order for this procedure. Review it before ordering again.',
          });
        const row = (
          await sql<{
            id: string;
          }>`INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region,laterality,urgency,indication,safety_context,ordered_by)VALUES(${patientId}::uuid,${input.encounterId}::uuid,${procedure.id}::uuid,${procedure.version},${procedure.code},${procedure.bodyRegion},${input.laterality},${input.urgency},${indication},${input.safetyContext.trim()},${scope.personId}::uuid)RETURNING id`.execute(
            trx,
          )
        ).rows[0]!;
        await commandEvidence(
          trx,
          scope,
          'imaging_order',
          row.id,
          'imaging.ordered',
          {
            patientId,
            encounterId: input.encounterId,
            procedureCode: procedure.code,
            procedureId: procedure.id,
            procedureVersion: procedure.version,
            version: 1,
          },
        );
        return { id: row.id };
      },
    );
    return this.get(scope, patientId, result.id);
  }
  async cancel(
    scope: PatientReadScope,
    patientId: string,
    id: string,
    input: StaffLabCancellation,
  ) {
    this.require(scope, 'imaging:cancel');
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1000)
      throw new BadRequestException('Enter a cancellation reason.');
    const result = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'imaging.cancelled',
      { patientId, id, ...input },
      async (trx) => {
        const current = (
          await sql<{
            encounter_id: string;
            status: string;
            version: number;
          }>`SELECT r.encounter_id,r.status,r.version FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id WHERE r.id=${id}::uuid AND ${this.patient(scope, patientId)} FOR UPDATE OF r`.execute(
            trx,
          )
        ).rows[0];
        if (!current)
          throw new NotFoundException(
            'This order is unavailable in your current care context.',
          );
        await this.context(trx, scope, patientId, current.encounter_id);
        const processed =
          await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(
            trx,
          );
        if (
          current.status !== 'ordered' ||
          current.version !== input.expectedVersion ||
          processed.rows.length
        )
          throw new ConflictException({
            code: 'IMAGING_CANCELLATION_UNAVAILABLE',
            message:
              'This order changed or imaging processing has started. Review its status and contact radiology.',
          });
        await sql`UPDATE img.img_order SET status='cancelled',version=version+1,cancel_reason=${reason},cancelled_by=${scope.personId}::uuid,cancelled_at=now() WHERE id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          scope,
          'imaging_order',
          id,
          'imaging.cancelled',
          {
            patientId,
            encounterId: current.encounter_id,
            status: 'cancelled',
            version: current.version + 1,
          },
        );
        return { id };
      },
    );
    return this.get(scope, patientId, result.id);
  }
}
