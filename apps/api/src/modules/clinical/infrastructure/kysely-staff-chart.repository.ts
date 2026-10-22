import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { StaffChartRepository } from '../domain/staff-chart.repository.js';
@Injectable()
export class KyselyStaffChartRepository implements StaffChartRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async sections(input: Parameters<StaffChartRepository['sections']>[0]) {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const observations = input.observations
          ? (
              await sql<{
                id: string;
                code: string;
                value: string | null;
                unit: string | null;
                taken_at: Date;
                origin: string;
                encounter_id: string | null;
              }>`
        SELECT DISTINCT ON(o.code) o.id,o.code,COALESCE(o.value_num::text,o.value_text) AS value,o.unit,o.taken_at,o.origin,o.encounter_id
        FROM clin.observation o JOIN patient.patient p ON p.id=o.patient_id AND p.facility_id=${input.facilityId}::uuid
        WHERE o.patient_id=${input.patientId}::uuid AND (o.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=o.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id))
        ORDER BY o.code,o.taken_at DESC,o.id DESC LIMIT 12`.execute(trx)
            ).rows
          : [];
        const allergySummary=input.entries?(await sql<NonNullable<import('@pulse/api-contracts').StaffChartOverview['entries']['allergySummary']>>`
          WITH records AS (SELECT n.*,d.criticality,d.corrected_at FROM clin.entry n LEFT JOIN clin.allergy_detail d ON d.entry_id=n.id
            WHERE n.patient_id=${input.patientId}::uuid AND n.kind='allergy' AND (n.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=n.encounter_id AND e.patient_id=n.patient_id AND e.facility_id=${input.facilityId}::uuid))),
          review AS (SELECT r.status,r.reviewed_at FROM clin.allergy_review r JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=r.patient_id AND e.facility_id=${input.facilityId}::uuid WHERE r.patient_id=${input.patientId}::uuid ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1)
          SELECT CASE WHEN count(*) FILTER(WHERE status='active')>0 THEN 'allergies-recorded'
            WHEN (SELECT reviewed_at FROM review)>=COALESCE(max(GREATEST(recorded_at,corrected_at)),'-infinity'::timestamptz) THEN COALESCE((SELECT status FROM review),'unknown') ELSE 'unknown' END AS status,
          (count(*) FILTER(WHERE status='active'))::int AS count,COALESCE(bool_or(criticality='high') FILTER(WHERE status='active'),false) AS "highCriticality",
          COALESCE((array_agg(display ORDER BY recorded_at DESC,id DESC) FILTER(WHERE status='active'))[1:5],ARRAY[]::text[]) AS substances,
          (SELECT reviewed_at::text FROM review) AS "reviewedAt" FROM records`.execute(trx)).rows[0]:undefined;
        const entries = input.entries
          ? (
              await sql<{
                id: string;
                kind: 'allergy' | 'problem' | 'diagnosis';
                verification_status: 'provisional'|'confirmed'|'differential'|null;
                display: string;
                status: string;
                recorded_at: Date;
                origin: string;
              }>`
        SELECT e.id,e.kind,e.display,e.status,e.recorded_at,e.origin,e.verification_status FROM clin.entry e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=${input.facilityId}::uuid
        WHERE e.patient_id=${input.patientId}::uuid AND (e.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter c WHERE c.id=e.encounter_id AND c.patient_id=p.id AND c.facility_id=p.facility_id))
        ORDER BY e.recorded_at DESC,e.id DESC LIMIT 50`.execute(trx)
            ).rows
          : [];
        await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)
        VALUES(${input.personId}::uuid,'staff','patient.chart_overview_read','patient',${input.patientId}::uuid,${input.organizationId}::uuid,${input.facilityId}::uuid,
        ${JSON.stringify({ observations: input.observations, entries: input.entries })}::jsonb)`.execute(
          trx,
        );
        return {
          observations: {
            access: input.observations
              ? ('available' as const)
              : ('restricted' as const),
            items: observations.map((o) => ({
              id: o.id,
              code: o.code,
              value: o.value,
              unit: o.unit,
              takenAt: o.taken_at.toISOString(),
              origin: o.origin,
              encounterId: o.encounter_id,
            })),
          },
          entries: {
            ...(allergySummary?{allergySummary}:{}),
            access: input.entries
              ? ('available' as const)
              : ('restricted' as const),
            items: entries.map((e) => ({
              id: e.id,
              kind: e.kind,
              display: e.display,
              status: e.status,
              verificationStatus: e.verification_status,
              recordedAt: e.recorded_at.toISOString(),
              origin: e.origin,
            })),
          },
        };
      });
  }
}
