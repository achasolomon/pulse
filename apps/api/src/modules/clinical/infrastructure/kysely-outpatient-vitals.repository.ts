import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { OutpatientVitalsRepository } from '../domain/outpatient-vitals.repository.js';
const units = {
  'heart-rate': 'bpm',
  'respiratory-rate': 'breaths/min',
  temperature: '°C',
  spo2: '%',
  'bp-systolic': 'mmHg',
  'bp-diastolic': 'mmHg',
  weight: 'kg',
  height: 'cm',
};
@Injectable()
export class KyselyOutpatientVitalsRepository implements OutpatientVitalsRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  record(
    scope: PatientReadScope,
    visitId: string,
    input: Parameters<OutpatientVitalsRepository['record']>[2],
  ) {
    return staffCommand(
      this.db,
      scope,
      input.commandKey,
      'outpatient.vitals-recorded',
      { visitId, ...input },
      async (trx) => {
        const rows = await sql<{
          patient_id: string;
          encounter_id: string;
          stage: string;
          nurse_person_id: string | null;
        }>`SELECT v.patient_id,v.encounter_id,v.stage,v.nurse_person_id FROM encounter.outpatient_visit v
    JOIN encounter.encounter e ON e.id=v.encounter_id AND e.patient_id=v.patient_id AND e.facility_id=v.facility_id AND e.status='open'
    JOIN patient.patient p ON p.id=v.patient_id AND p.facility_id=v.facility_id
    WHERE v.id=${visitId}::uuid AND v.facility_id=${scope.facilityId}::uuid AND v.organization_id=${scope.organizationId}::uuid FOR UPDATE OF v`.execute(
          trx,
        );
        const visit = rows.rows[0];
        if (!visit)
          throw new NotFoundException({
            code: 'VISIT_NOT_FOUND',
            message: 'Visit is unavailable in this facility',
          });
        if (
          visit.nurse_person_id !== scope.personId ||
          !['vitals-in-progress', 'vitals-recorded'].includes(visit.stage)
        )
          throw new ConflictException({
            code: 'VITALS_NOT_ASSIGNED',
            message:
              'Claim this visit before recording vitals, and do not edit it after handoff',
          });
        const care =
          await sql`SELECT id FROM iam.care_assignment WHERE patient_id=${visit.patient_id}::uuid AND encounter_id=${visit.encounter_id}::uuid AND facility_id=${scope.facilityId}::uuid AND person_id=${scope.personId}::uuid AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) LIMIT 1`.execute(
            trx,
          );
        if (!care.rows.length)
          throw new ConflictException({
            code: 'CARE_ACCESS_REQUIRED',
            message: 'Your care assignment is no longer active',
          });
        for (const measurement of input.measurements) {
          const created = await sql<{
            id: string;
          }>`INSERT INTO clin.observation(patient_id,encounter_id,code,value_num,unit,taken_at,recorded_by)
     VALUES(${visit.patient_id}::uuid,${visit.encounter_id}::uuid,${measurement.code},${measurement.value},${units[measurement.code]},${input.takenAt}::timestamptz,${scope.personId}::uuid)RETURNING id`.execute(
            trx,
          );
          await commandEvidence(
            trx,
            scope,
            'observation',
            created.rows[0]!.id,
            'observation.recorded',
            {
              patientId: visit.patient_id,
              encounterId: visit.encounter_id,
              code: measurement.code,
            },
          );
        }
        await sql`UPDATE encounter.outpatient_visit SET stage='vitals-recorded',updated_at=now()WHERE id=${visitId}::uuid`.execute(
          trx,
        );
        await sql`INSERT INTO encounter.outpatient_visit_history(visit_id,actor_id,from_stage,to_stage)VALUES(${visitId}::uuid,${scope.personId}::uuid,${visit.stage},'vitals-recorded')`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          scope,
          'outpatient_visit',
          visitId,
          'outpatient.vitals-recorded',
          {
            encounterId: visit.encounter_id,
            recorded: input.measurements.length,
          },
        );
        return { visitId, recorded: input.measurements.length };
      },
    );
  }
}
