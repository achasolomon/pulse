import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { OutpatientVisit } from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { OutpatientRepository } from '../domain/outpatient.repository.js';
type Row = {
  id: string;
  encounter_id: string;
  patient_id: string;
  stage: OutpatientVisit['stage'];
  nurse_person_id: string | null;
  clinician_person_id: string | null;
  checked_in_at: Date;
  updated_at: Date;
  given_name: string;
  family_name: string;
  date_of_birth: Date;
  sex: OutpatientVisit['patient']['sex'];
  facility_id: string;
  mrn: string | null;
};
const projection = sql`v.id,v.encounter_id,v.patient_id,v.stage,v.nurse_person_id,v.clinician_person_id,v.checked_in_at,v.updated_at,p.given_name,p.family_name,p.date_of_birth,p.sex,p.facility_id,
 (SELECT value FROM patient.identifier i WHERE i.patient_id=p.id AND i.system='urn:pulse:mrn:'||p.facility_id::text LIMIT 1) AS mrn`;
function map(r: Row): OutpatientVisit {
  return {
    id: r.id,
    encounterId: r.encounter_id,
    stage: r.stage,
    nursePersonId: r.nurse_person_id,
    clinicianPersonId: r.clinician_person_id,
    checkedInAt: r.checked_in_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    patient: {
      id: r.patient_id,
      givenName: r.given_name,
      familyName: r.family_name,
      dateOfBirth: toDateOnly(r.date_of_birth),
      sex: r.sex,
      facilityId: r.facility_id,
      mrn: r.mrn,
      status: 'active',
    },
  };
}
@Injectable()
export class KyselyOutpatientRepository implements OutpatientRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async list(
    scope: PatientReadScope,
    queue: 'reception' | 'vitals' | 'consultation',
  ) {
    const filter =
      queue === 'vitals'
        ? sql`AND (v.stage='waiting-vitals' OR (v.stage IN ('vitals-in-progress','vitals-recorded') AND v.nurse_person_id=${scope.personId}::uuid))`
        : queue === 'consultation'
          ? sql`AND v.stage IN ('waiting-consultation','in-consultation') AND v.clinician_person_id=${scope.personId}::uuid`
          : sql`AND v.stage NOT IN ('completed','cancelled')`;
    const rows =
      await sql<Row>`SELECT ${projection} FROM encounter.outpatient_visit v JOIN patient.patient p ON p.id=v.patient_id AND p.facility_id=v.facility_id
   JOIN encounter.encounter e ON e.id=v.encounter_id AND e.patient_id=v.patient_id AND e.facility_id=v.facility_id AND e.status='open'
   WHERE v.facility_id=${scope.facilityId}::uuid AND v.organization_id=${scope.organizationId}::uuid ${filter} ORDER BY v.checked_in_at,v.id LIMIT 100`.execute(
        this.db,
      );
    return rows.rows.map(map);
  }
  async get(scope: PatientReadScope, id: string) {
    const rows =
      await sql<Row>`SELECT ${projection} FROM encounter.outpatient_visit v JOIN patient.patient p ON p.id=v.patient_id AND p.facility_id=v.facility_id
    JOIN encounter.encounter e ON e.id=v.encounter_id AND e.patient_id=v.patient_id AND e.facility_id=v.facility_id
    WHERE v.id=${id}::uuid AND v.facility_id=${scope.facilityId}::uuid AND v.organization_id=${scope.organizationId}::uuid`.execute(
        this.db,
      );
    if (!rows.rows[0])
      throw new NotFoundException({
        code: 'VISIT_NOT_FOUND',
        message: 'Visit is unavailable in this facility',
      });
    return map(rows.rows[0]);
  }
  async current(scope: PatientReadScope, patientId: string) {
    const row = await sql<{
      id: string;
    }>`SELECT id FROM encounter.outpatient_visit WHERE patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND organization_id=${scope.organizationId}::uuid AND stage NOT IN ('completed','cancelled') LIMIT 1`.execute(
      this.db,
    );
    return row.rows[0] ? this.get(scope, row.rows[0].id) : null;
  }
  async clinicians(scope: PatientReadScope) {
    const rows = await sql<{
      person_id: string;
      login_id: string;
    }>`SELECT DISTINCT m.person_id,c.login_id FROM iam.membership m JOIN iam.credential c ON c.person_id=m.person_id AND c.status='active'
    WHERE m.organization_id=${scope.organizationId}::uuid AND m.facility_id=${scope.facilityId}::uuid AND m.privileges @> ARRAY['encounter:consult']::text[]
    AND (m.effective_from IS NULL OR m.effective_from<=now()) AND (m.effective_to IS NULL OR m.effective_to>now())
    AND m.id=(SELECT newest.id FROM iam.membership newest WHERE newest.person_id=m.person_id AND newest.facility_id=m.facility_id AND newest.organization_id=m.organization_id AND (newest.effective_from IS NULL OR newest.effective_from<=now()) AND (newest.effective_to IS NULL OR newest.effective_to>now()) ORDER BY newest.created_at DESC LIMIT 1)
    ORDER BY c.login_id`.execute(this.db);
    return rows.rows.map((r) => ({
      personId: r.person_id,
      loginId: r.login_id,
    }));
  }
  async history(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    id: string,
    from: string | null,
    to: string,
  ) {
    await sql`INSERT INTO encounter.outpatient_visit_history(visit_id,actor_id,from_stage,to_stage)VALUES(${id}::uuid,${scope.personId}::uuid,${from},${to})`.execute(
      trx,
    );
    await commandEvidence(trx, scope, 'outpatient_visit', id, `outpatient.${to}`, {
      fromStage: from,
      toStage: to,
    });
  }
  async checkIn(
    scope: PatientReadScope,
    input: { patientId: string; appointmentId?: string; commandKey: string },
  ) {
    const result = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'outpatient.check-in',
      input,
      async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.facilityId}/${input.patientId}/outpatient`},0))`.execute(
          trx,
        );
        const patient =
          await sql`SELECT id FROM patient.patient WHERE id=${input.patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND status='active' FOR SHARE`.execute(
            trx,
          );
        if (!patient.rows.length)
          throw new NotFoundException({
            code: 'PATIENT_NOT_FOUND',
            message: 'Select an active patient in this facility',
          });
        const existing = await sql<{
          id: string;
        }>`SELECT id FROM encounter.outpatient_visit WHERE facility_id=${scope.facilityId}::uuid AND patient_id=${input.patientId}::uuid AND stage NOT IN ('completed','cancelled') LIMIT 1`.execute(
          trx,
        );
        if (existing.rows[0]) {
          if (input.appointmentId) {
            const matching =
              await sql`SELECT id FROM encounter.outpatient_visit WHERE id=${existing.rows[0].id}::uuid AND appointment_id=${input.appointmentId}::uuid`.execute(
                trx,
              );
            if (!matching.rows.length)
              throw new ConflictException({
                code: 'APPOINTMENT_UNAVAILABLE',
                message:
                  'The patient already has an active visit for a different check-in',
              });
          }
          return { id: existing.rows[0].id };
        }
        if (input.appointmentId) {
          const appointment =
            await sql`UPDATE sched.appointment SET status='checked-in' WHERE id=${input.appointmentId}::uuid AND patient_id=${input.patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND status='scheduled' RETURNING id`.execute(
              trx,
            );
          if (!appointment.rows.length)
            throw new ConflictException({
              code: 'APPOINTMENT_UNAVAILABLE',
              message: 'This appointment cannot be checked in',
            });
        }
        const enc = await trx
          .insertInto('encounter.encounter')
          .values({
            patient_id: input.patientId,
            facility_id: scope.facilityId,
            type: 'outpatient',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const visit = await sql<{
          id: string;
        }>`INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,appointment_id,checked_in_by)
    VALUES(${enc.id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid,${input.patientId}::uuid,${input.appointmentId ?? null}::uuid,${scope.personId}::uuid) RETURNING id`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          scope,
          'encounter',
          enc.id,
          'encounter.opened',
          { patientId: input.patientId },
        );
        if (input.appointmentId)
          await commandEvidence(
            trx,
            scope,
            'appointment',
            input.appointmentId,
            'appointment.checked-in',
          );
        await this.history(
          trx,
          scope,
          visit.rows[0]!.id,
          null,
          'waiting-vitals',
        );
        return { id: visit.rows[0]!.id };
      },
    );
    return this.get(scope, result.id);
  }
  async move(
    scope: PatientReadScope,
    id: string,
    action: 'claim' | 'handoff' | 'start',
    key: string,
    clinicianId?: string,
  ) {
    const result = await staffCommand(
      this.db,
      scope,
      key,
      `outpatient.${action}`,
      { id, clinicianId: clinicianId ?? null },
      async (trx) => {
        const rows = await sql<{
          encounter_id: string;
          patient_id: string;
          stage: string;
          nurse_person_id: string | null;
          clinician_person_id: string | null;
        }>`SELECT v.encounter_id,v.patient_id,v.stage,v.nurse_person_id,v.clinician_person_id FROM encounter.outpatient_visit v JOIN encounter.encounter e ON e.id=v.encounter_id AND e.facility_id=v.facility_id AND e.patient_id=v.patient_id
    WHERE v.id=${id}::uuid AND v.facility_id=${scope.facilityId}::uuid AND v.organization_id=${scope.organizationId}::uuid AND e.status='open' FOR UPDATE OF v`.execute(
          trx,
        );
        const current = rows.rows[0];
        if (!current)
          throw new NotFoundException({
            code: 'VISIT_NOT_FOUND',
            message: 'Visit is unavailable in this facility',
          });
        let stage: string;
        if (action === 'claim') {
          if (
            current.stage === 'vitals-in-progress' &&
            current.nurse_person_id === scope.personId
          )
            return { id };
          if (current.stage !== 'waiting-vitals')
            throw new ConflictException({
              code: 'VISIT_ALREADY_CLAIMED',
              message:
                'This visit has already been picked up. Refresh the queue.',
            });
          stage = 'vitals-in-progress';
          await sql`UPDATE encounter.outpatient_visit SET nurse_person_id=${scope.personId}::uuid WHERE id=${id}::uuid`.execute(
            trx,
          );
          await this.assign(
            trx,
            scope,
            current.patient_id,
            current.encounter_id,
            scope.personId,
            'outpatient-vitals',
          );
        } else if (action === 'handoff') {
          if (
            current.stage !== 'vitals-recorded' ||
            current.nurse_person_id !== scope.personId
          )
            throw new ConflictException({
              code: 'VITALS_HANDOFF_REQUIRED',
              message:
                'Record vitals for your claimed visit before handing it over',
            });
          const clinician =
            await sql`SELECT m.id FROM iam.membership m WHERE m.person_id=${clinicianId ?? null}::uuid AND m.facility_id=${scope.facilityId}::uuid AND m.organization_id=${scope.organizationId}::uuid AND m.privileges @> ARRAY['encounter:consult']::text[] AND (m.effective_from IS NULL OR m.effective_from<=now()) AND (m.effective_to IS NULL OR m.effective_to>now()) AND EXISTS(SELECT 1 FROM iam.credential c WHERE c.person_id=m.person_id AND c.status='active')
            AND m.id=(SELECT newest.id FROM iam.membership newest WHERE newest.person_id=m.person_id AND newest.facility_id=m.facility_id AND newest.organization_id=m.organization_id AND (newest.effective_from IS NULL OR newest.effective_from<=now()) AND (newest.effective_to IS NULL OR newest.effective_to>now()) ORDER BY newest.created_at DESC LIMIT 1)
            LIMIT 1`.execute(
              trx,
            );
          if (!clinician.rows.length)
            throw new ConflictException({
              code: 'CONSULTATION_STAFF_UNAVAILABLE',
              message: 'Select active consultation staff in this facility',
            });
          stage = 'waiting-consultation';
          await sql`UPDATE encounter.outpatient_visit SET clinician_person_id=${clinicianId!}::uuid WHERE id=${id}::uuid`.execute(
            trx,
          );
          await this.assign(
            trx,
            scope,
            current.patient_id,
            current.encounter_id,
            clinicianId!,
            'outpatient-consultation',
          );
        } else {
          if (
            current.stage !== 'waiting-consultation' ||
            current.clinician_person_id !== scope.personId
          )
            throw new ConflictException({
              code: 'CONSULTATION_NOT_ASSIGNED',
              message: 'This consultation is not waiting for you',
            });
          stage = 'in-consultation';
        }
        await sql`UPDATE encounter.outpatient_visit SET stage=${stage},updated_at=now() WHERE id=${id}::uuid`.execute(
          trx,
        );
        await this.history(trx, scope, id, current.stage, stage);
        return { id };
      },
    );
    return this.get(scope, result.id);
  }
  async assign(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    patientId: string,
    encounterId: string,
    personId: string,
    kind: string,
  ) {
    await sql`INSERT INTO iam.care_assignment(patient_id,person_id,facility_id,encounter_id,kind)
    SELECT ${patientId}::uuid,${personId}::uuid,${scope.facilityId}::uuid,${encounterId}::uuid,${kind}
    WHERE NOT EXISTS(SELECT 1 FROM iam.care_assignment WHERE encounter_id=${encounterId}::uuid AND person_id=${personId}::uuid AND kind=${kind} AND effective_to IS NULL)`.execute(
      trx,
    );
  }
}
