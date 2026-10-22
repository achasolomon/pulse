import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { StaffPatientIdentity } from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import type {
  PatientReadScope,
  StaffPatientReadRepository,
} from '../domain/staff-patient-read.repository.js';
type PatientRow = {
  id: string;
  family_name: string;
  given_name: string;
  date_of_birth: Date | string;
  sex: StaffPatientIdentity['sex'];
  status: StaffPatientIdentity['status'];
  facility_id: string;
  mrn: string | null;
};
const projection = sql`p.id,p.family_name,p.given_name,p.date_of_birth,p.sex,p.status,p.facility_id,
  (SELECT i.value FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id
   AND i.system='urn:pulse:mrn:'||p.facility_id::text ORDER BY i.created_at,i.id LIMIT 1) AS mrn`;
function map(row: PatientRow): StaffPatientIdentity {
  return {
    id: row.id,
    familyName: row.family_name,
    givenName: row.given_name,
    dateOfBirth: toDateOnly(row.date_of_birth),
    sex: row.sex,
    status: row.status,
    facilityId: row.facility_id,
    mrn: row.mrn,
  };
}
@Injectable()
export class KyselyStaffPatientReadRepository implements StaffPatientReadRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async list(
    scope: PatientReadScope,
    query: string,
    status: string,
    cursor?: string,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const result =
        await sql<PatientRow>`SELECT ${projection} FROM patient.patient p JOIN org.facility f ON f.id=p.facility_id
        WHERE p.facility_id=${scope.facilityId}::uuid AND f.organization_id=${scope.organizationId}::uuid
        ${status === 'all' ? sql`` : sql`AND p.status=${status}`}
        ${cursor ? sql`AND p.id>${cursor}::uuid` : sql``}
        ${
          query
            ? sql`AND (starts_with(lower(p.family_name),lower(${query})) OR starts_with(lower(p.given_name),lower(${query}))
          OR starts_with(lower(p.given_name||' '||p.family_name),lower(${query}))
          OR EXISTS(SELECT 1 FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.value=${query}))`
            : sql``
        }
        ORDER BY p.id LIMIT 26`.execute(trx);
      await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,tenant_id,facility_id,metadata)
        VALUES(${scope.personId}::uuid,'staff','patient.directory_read','patient',${scope.organizationId}::uuid,${scope.facilityId}::uuid,
        ${JSON.stringify({ queryPresent: Boolean(query), resultCount: Math.min(result.rows.length, 25) })}::jsonb)`.execute(
        trx,
      );
      const rows = result.rows.slice(0, 25);
      return {
        items: rows.map(map),
        nextCursor: result.rows.length > 25 ? rows.at(-1)!.id : null,
      };
    });
  }
  async identity(scope: PatientReadScope, id: string) {
    return this.db.transaction().execute(async (trx) => {
      const result =
        await sql<PatientRow>`SELECT ${projection} FROM patient.patient p JOIN org.facility f ON f.id=p.facility_id
        WHERE p.id=${id}::uuid AND p.facility_id=${scope.facilityId}::uuid AND f.organization_id=${scope.organizationId}::uuid`.execute(
          trx,
        );
      const row = result.rows[0];
      if (!row) return undefined;
      const target = await sql<{
        survivor_id: string;
      }>`SELECT m.survivor_id FROM patient.merge_link m JOIN patient.patient p ON p.id=m.survivor_id
        WHERE m.duplicate_id=${id}::uuid AND p.facility_id=${scope.facilityId}::uuid ORDER BY m.created_at DESC LIMIT 1`.execute(
        trx,
      );
      await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)
        VALUES(${scope.personId}::uuid,'staff','patient.identity_read','patient',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid,'{}'::jsonb)`.execute(
        trx,
      );
      return {
        ...map(row),
        ...(target.rows[0] ? { mergedInto: target.rows[0].survivor_id } : {}),
      };
    });
  }
}
