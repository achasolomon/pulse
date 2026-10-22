import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type {
  PatientRegistrationInput,
  PatientRegistrationResult,
  StaffPatientIdentity,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../domain/staff-patient-read.repository.js';
import type { StaffRegistrationRepository } from '../domain/staff-registration.repository.js';
@Injectable()
export class KyselyStaffRegistrationRepository implements StaffRegistrationRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async register(
    scope: PatientReadScope,
    input: PatientRegistrationInput,
  ): Promise<PatientRegistrationResult> {
    const receipt = await staffCommand<
      | { kind: 'registered'; patientId: string; mrn: string }
      | { kind: 'duplicate-review'; ids: string[] }
    >(
      this.db,
      scope,
      input.commandKey,
      'patient.register',
      input,
      async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.facilityId}/${input.familyName.toLowerCase()}/${input.dateOfBirth}`},0))`.execute(
          trx,
        );
        const duplicates = await sql<{
          id: string;
        }>`SELECT id FROM patient.patient WHERE facility_id=${scope.facilityId}::uuid AND status='active'
        AND lower(family_name)=lower(${input.familyName}) AND date_of_birth=${input.dateOfBirth}::date ORDER BY id LIMIT 10`.execute(
          trx,
        );
        if (duplicates.rows.length && !input.confirmDuplicate)
          return {
            kind: 'duplicate-review',
            ids: duplicates.rows.map((p) => p.id),
          };
        const mrn = (
          await sql<{
            mrn: string;
          }>`SELECT 'P-'||code||'-'||lpad(s.seq,greatest(8,length(s.seq)),'0') AS mrn FROM org.facility CROSS JOIN (SELECT nextval('patient.local_mrn_sequence')::text AS seq) s WHERE id=${scope.facilityId}::uuid AND organization_id=${scope.organizationId}::uuid`.execute(
            trx,
          )
        ).rows[0]!.mrn;
        const created = await sql<{
          id: string;
        }>`INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id,contact_phone,contact_address)
    VALUES(${input.givenName},${input.familyName},${input.dateOfBirth}::date,${input.sex},${scope.facilityId}::uuid,${input.phone ?? null},${input.address ?? null}) RETURNING id`.execute(
          trx,
        );
        const id = created.rows[0]!.id;
        await trx
          .insertInto('patient.identifier')
          .values({
            patient_id: id,
            system: `urn:pulse:mrn:${scope.facilityId}`,
            value: mrn,
            facility_id: scope.facilityId,
          })
          .execute();
        await commandEvidence(trx, scope, 'patient', id, 'patient.registered', {
          duplicateReviewConfirmed: input.confirmDuplicate === true,
        });
        return { kind: 'registered', patientId: id, mrn };
      },
    );
    if (receipt.kind === 'registered') return receipt;
    const rows = await sql<{
      id: string;
      given_name: string;
      family_name: string;
      date_of_birth: Date;
      sex: StaffPatientIdentity['sex'];
      mrn: string | null;
    }>`SELECT p.id,p.given_name,p.family_name,p.date_of_birth,p.sex,
   (SELECT value FROM patient.identifier i WHERE i.patient_id=p.id AND i.system=${`urn:pulse:mrn:${scope.facilityId}`} LIMIT 1) AS mrn
   FROM patient.patient p WHERE p.facility_id=${scope.facilityId}::uuid AND p.id=ANY(${receipt.ids}::uuid[])`.execute(
      this.db,
    );
    return {
      kind: 'duplicate-review',
      candidates: rows.rows.map((p) => ({
        id: p.id,
        givenName: p.given_name,
        familyName: p.family_name,
        dateOfBirth: toDateOnly(p.date_of_birth),
        sex: p.sex,
        mrn: p.mrn,
        facilityId: scope.facilityId,
        status: 'active',
      })),
    };
  }
}
