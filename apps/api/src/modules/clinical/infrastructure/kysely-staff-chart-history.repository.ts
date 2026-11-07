import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type {
  StaffChartSection,
  StaffChartHistoryItem,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { StaffChartHistoryRepository } from '../domain/staff-chart-history.repository.js';
type Row = {
  diagnostic: StaffChartHistoryItem['diagnostic'];
  note: {authorId:string|null;kind:'clinical'|'consultation'|'nursing';version:number} | null;
  encounter: { type: string; startedAt: string } | null;
  id: string;
  title: string;
  status: string;
  occurred_at: Date;
  cursor_at: string;
  encounter_id: string | null;
  fields: StaffChartHistoryItem['fields'];
};
@Injectable()
export class KyselyStaffChartHistoryRepository implements StaffChartHistoryRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async read(
    scope: PatientReadScope,
    patientId: string,
    section: StaffChartSection,
    cursor?: string,
    encounterId?: string,
  ) {
    let position: { at: string; id: string } | null = null;
    if (cursor) {
      try {
        position = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (
          !position ||
          !/^\d{4}-\d\d-\d\dT/.test(position.at) ||
          !Number.isFinite(Date.parse(position.at)) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            position.id,
          )
        )
          throw new Error();
      } catch {
        throw new BadRequestException({ message: 'Invalid history page' });
      }
    }
    const patient = sql`p.id=${patientId}::uuid AND p.facility_id=${scope.facilityId}::uuid`;
    const encounter = sql`e.patient_id=p.id AND e.facility_id=p.facility_id`;
    const diagnostic = section === 'investigations' ? sql`CASE
      WHEN records.fields->0->>'value'='Laboratory' AND ${scope.privileges.includes('lab:read')} THEN (
        SELECT jsonb_build_object('kind','laboratory','verifiedAt',r.verified_at,'report',NULL,'results',
          CASE WHEN r.status='verified' AND r.verified_at IS NOT NULL THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('component',v.component,'value',v.value_text,'unit',v.unit,'flag',v.flag,'version',v.version,'recordedAt',v.created_at) ORDER BY v.component)
            FROM (SELECT DISTINCT ON(component) component,value_text,unit,flag,version,created_at FROM lab.result WHERE order_id=r.id AND created_at<=r.verified_at ORDER BY component,version DESC,created_at DESC,id DESC) v
          ),'[]'::jsonb) ELSE '[]'::jsonb END)
        FROM lab.lab_order r WHERE r.id=records.id AND r.patient_id=${patientId}::uuid
      )
      WHEN records.fields->0->>'value'='Imaging' AND ${scope.privileges.includes('imaging:view')} THEN (
        SELECT jsonb_build_object('kind','imaging','verifiedAt',CASE WHEN r.status='final' THEN (SELECT sign.created_at FROM img.report rp LEFT JOIN img.report_signoff sign ON sign.report_id=rp.id WHERE rp.order_id=r.id ORDER BY rp.version DESC,rp.created_at DESC,rp.id DESC LIMIT 1) ELSE NULL END,'results','[]'::jsonb,'report',
          CASE WHEN r.status='final' THEN (SELECT CASE WHEN rp.status='final' THEN jsonb_build_object('text',rp.text,'version',rp.version) ELSE NULL END FROM img.report rp WHERE rp.order_id=r.id ORDER BY rp.version DESC,rp.created_at DESC,rp.id DESC LIMIT 1) ELSE NULL END)
        FROM img.img_order r WHERE r.id=records.id AND r.patient_id=${patientId}::uuid
      ) ELSE NULL END` : sql`NULL::jsonb`;
    const queries: Record<StaffChartSection, RawBuilder<unknown>> = {
      visits: sql`SELECT e.id,initcap(e.type)||' visit' AS title,e.status,e.started_at AS occurred_at,e.id AS encounter_id,
    jsonb_build_array(jsonb_build_object('label','Department','value',d.name),jsonb_build_object('label','Visit stage','value',v.stage),jsonb_build_object('label','Ended','value',e.ended_at::text),jsonb_build_object('label','Disposition','value',e.disposition),jsonb_build_object('label','Location / bed','value',e.bed)) AS fields
    FROM encounter.encounter e JOIN patient.patient p ON ${encounter} LEFT JOIN org.department d ON d.id=e.department_id AND d.facility_id=p.facility_id LEFT JOIN encounter.outpatient_visit v ON v.encounter_id=e.id AND v.facility_id=p.facility_id AND v.patient_id=p.id WHERE ${patient}`,
      vitals: sql`SELECT o.id,o.code AS title,'recorded'::text AS status,o.taken_at AS occurred_at,o.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Value','value',concat_ws(' ',COALESCE(o.value_num::text,o.value_text),o.unit)),jsonb_build_object('label','Source','value',o.origin),jsonb_build_object('label','Recorded by','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=o.recorded_by ORDER BY c.created_at DESC LIMIT 1))) AS fields
    FROM clin.observation o JOIN patient.patient p ON p.id=o.patient_id WHERE ${patient} AND (o.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=o.encounter_id AND ${encounter}))`,
      entries: sql`SELECT n.id,n.display AS title,CASE WHEN ad.corrected_at IS NOT NULL THEN 'entered-in-error' ELSE n.status END AS status,n.recorded_at AS occurred_at,n.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Type','value',n.kind),jsonb_build_object('label','Verification status','value',n.verification_status),jsonb_build_object('label','Code','value',n.code),jsonb_build_object('label','Source','value',n.origin),jsonb_build_object('label','Recorded by','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=n.recorded_by ORDER BY c.created_at DESC LIMIT 1)),jsonb_build_object('label','Resolved at','value',n.resolved_at::text),jsonb_build_object('label','Resolved by','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=n.resolved_by ORDER BY c.created_at DESC LIMIT 1)),jsonb_build_object('label','Resolution reason','value',n.resolution_reason),jsonb_build_object('label','Reaction','value',ad.reaction),jsonb_build_object('label','Reaction severity','value',ad.severity),jsonb_build_object('label','Criticality','value',ad.criticality),jsonb_build_object('label','Allergy category','value',ad.category),jsonb_build_object('label','Allergy type','value',ad.allergy_type),jsonb_build_object('label','Information source','value',ad.information_source),jsonb_build_object('label','Correction reason','value',ad.correction_reason),jsonb_build_object('label','Corrected at','value',ad.corrected_at::text),jsonb_build_object('label','Corrected by','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=ad.corrected_by ORDER BY c.created_at DESC LIMIT 1))) AS fields
    FROM clin.entry n LEFT JOIN clin.allergy_detail ad ON ad.entry_id=n.id JOIN patient.patient p ON p.id=n.patient_id WHERE ${patient} AND (n.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=n.encounter_id AND ${encounter}))`,
      notes: sql`SELECT n.id,COALESCE(NULLIF(n.chief_complaint,''),'Clinical note') AS title,n.status,n.created_at AS occurred_at,n.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Note type','value',n.note_type),jsonb_build_object('label','History','value',n.history),jsonb_build_object('label','Examination','value',n.examination),jsonb_build_object('label','Assessment','value',n.assessment),jsonb_build_object('label','Plan','value',n.plan),jsonb_build_object('label','Author','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=n.author_id ORDER BY c.created_at DESC LIMIT 1)),jsonb_build_object('label','Signed at','value',n.signed_at::text),jsonb_build_object('label','Addenda (chronological)','value',(SELECT string_agg(a.created_at::text||E'\n'||COALESCE((SELECT c.login_id FROM iam.credential c WHERE c.person_id=a.author_id ORDER BY c.created_at DESC LIMIT 1),'Author not recorded')||E'\n'||a.text,E'\n\n' ORDER BY a.created_at,a.id) FROM clin.note_addendum a WHERE a.note_id=n.id))) AS fields
    FROM clin.note n JOIN patient.patient p ON p.id=n.patient_id JOIN encounter.encounter e ON e.id=n.encounter_id AND ${encounter} WHERE ${patient} AND (n.status='signed' OR n.author_id=${scope.personId}::uuid)`,
      medications: sql`SELECT r.id,m.name AS title,r.status,r.created_at AS occurred_at,r.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Dose','value',concat_ws(' ',r.dose,r.dose_unit)),jsonb_build_object('label','Route','value',r.route),jsonb_build_object('label','Frequency','value',r.frequency),jsonb_build_object('label','Hold reason','value',r.hold_reason),jsonb_build_object('label','Cancellation reason','value',r.cancel_reason),jsonb_build_object('label','Recent administrations (up to 10)','value',(SELECT string_agg(a.given_at::text||' · '||a.outcome||' · '||a.dose_given||CASE WHEN a.reason<>'' THEN ' · '||a.reason ELSE '' END,E'\n' ORDER BY a.given_at DESC,a.id DESC) FROM (SELECT * FROM med.administration a WHERE a.request_id=r.id ORDER BY a.given_at DESC,a.id DESC LIMIT 10) a))) AS fields
    FROM med.request r JOIN med.medication m ON m.id=r.medication_id JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND ${encounter} WHERE ${patient}`,
      investigations: sql`SELECT r.id,t.name AS title,r.status,r.created_at AS occurred_at,r.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Type','value','Laboratory'),jsonb_build_object('label','Urgency','value',r.urgency),jsonb_build_object('label','Indication','value',r.indication),jsonb_build_object('label','Verified at','value',r.verified_at::text),jsonb_build_object('label','Catalogue code','value',t.code),jsonb_build_object('label','Catalogue version','value',r.test_version::text),jsonb_build_object('label','Ordered by','value',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.ordered_by ORDER BY c.created_at DESC LIMIT 1)),jsonb_build_object('label','Cancellation reason','value',r.cancel_reason),jsonb_build_object('label','Cancelled at','value',r.cancelled_at::text),jsonb_build_object('label','Specimen collection','value',(SELECT string_agg(s.label||' / '||s.container||' / '||s.collected_at::text||' / '||COALESCE((SELECT c.login_id FROM iam.credential c WHERE c.person_id=s.collected_by ORDER BY c.created_at DESC LIMIT 1),'Collector not recorded'),E'\n' ORDER BY s.collected_at,s.id) FROM lab.specimen s WHERE s.order_id=r.id)),jsonb_build_object('label','Specimen accession','value',(SELECT string_agg(a.accession_number||' / '||a.received_at::text||' / '||COALESCE((SELECT c.login_id FROM iam.credential c WHERE c.person_id=a.received_by ORDER BY c.created_at DESC LIMIT 1),'Receiving staff not recorded'),E'\n' ORDER BY a.received_at,s.id) FROM lab.specimen s JOIN lab.specimen_accession a ON a.specimen_id=s.id AND a.facility_id=p.facility_id WHERE s.order_id=r.id)),jsonb_build_object('label','Critical communication','value',CASE WHEN r.status='verified' THEN (SELECT 'Acknowledged '||c.acknowledged_at::text||' / '||COALESCE((SELECT cr.login_id FROM iam.credential cr WHERE cr.person_id=c.acknowledged_by ORDER BY cr.created_at DESC LIMIT 1),'Named clinician')||' / confirmed '||c.created_at::text FROM lab.critical_case c WHERE c.order_id=r.id AND c.facility_id=p.facility_id AND c.acknowledged_at IS NOT NULL) ELSE NULL END)) AS fields
    FROM lab.lab_order r JOIN lab.test t ON t.id=r.test_id JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND ${encounter} WHERE ${patient} AND ${scope.privileges.includes('lab:read')}
    UNION ALL SELECT r.id,COALESCE(pr.name,r.procedure_code) AS title,r.status,r.created_at AS occurred_at,r.encounter_id,
    jsonb_build_array(jsonb_build_object('label','Type','value','Imaging'),jsonb_build_object('label','Clinical acknowledgement','value',CASE WHEN r.status='final' THEN (SELECT 'Acknowledged '||c.acknowledged_at::text||' / '||COALESCE((SELECT login_id FROM iam.credential WHERE person_id=c.acknowledged_by ORDER BY created_at DESC LIMIT 1),'Named clinician') FROM img.critical_case c WHERE c.order_id=r.id AND c.acknowledged_at IS NOT NULL) ELSE NULL END),jsonb_build_object('label','Body region','value',r.body_region),jsonb_build_object('label','Laterality','value',r.laterality),jsonb_build_object('label','Indication','value',r.indication),jsonb_build_object('label','Modality','value',pr.modality),jsonb_build_object('label','Catalogue version','value',r.procedure_version::text),jsonb_build_object('label','Safety context supplied','value',r.safety_context),jsonb_build_object('label','Ordered by','value',(SELECT login_id FROM iam.credential WHERE person_id=r.ordered_by ORDER BY created_at DESC LIMIT 1)),jsonb_build_object('label','Cancellation reason','value',r.cancel_reason),jsonb_build_object('label','Cancelled at','value',r.cancelled_at::text)) AS fields
    FROM img.img_order r LEFT JOIN img.procedure pr ON pr.id=r.procedure_id AND pr.version=r.procedure_version JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND ${encounter} WHERE ${patient} AND ${scope.privileges.includes('imaging:view')}`,
      documents: sql`SELECT d.id,d.name AS title,'registered'::text AS status,d.created_at AS occurred_at,d.encounter_id,jsonb_build_array(jsonb_build_object('label','File type','value',d.mime)) AS fields
    FROM docs.document d JOIN patient.patient p ON p.id=d.patient_id WHERE ${patient} AND (d.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=d.encounter_id AND ${encounter}))`,
      profile: sql`SELECT p.id,'Registration details'::text AS title,p.status,p.created_at AS occurred_at,NULL::uuid AS encounter_id,
    jsonb_build_array(jsonb_build_object('label','Phone','value',p.contact_phone),jsonb_build_object('label','Address','value',p.contact_address)) AS fields FROM patient.patient p WHERE ${patient}`,
    };
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const rows = (
          await sql<Row>`WITH records AS (${queries[section]}) SELECT *,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
          (SELECT jsonb_build_object('type',e.type,'startedAt',e.started_at) FROM encounter.encounter e WHERE e.id=records.encounter_id AND e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid) AS encounter
          ,${section==='notes'?sql`(SELECT jsonb_build_object('authorId',n.author_id,'kind',n.note_type,'version',n.version,'richText',n.rich_text) FROM clin.note n WHERE n.id=records.id AND n.patient_id=${patientId}::uuid)`:sql`NULL::jsonb`} AS note
          ,${diagnostic} AS diagnostic
          FROM records WHERE true ${position ? sql`AND (occurred_at,id)<(${position.at}::timestamptz,${position.id}::uuid)` : sql``} ${encounterId ? sql`AND encounter_id=${encounterId}::uuid` : sql``} ORDER BY occurred_at DESC,id DESC LIMIT 26`.execute(
            trx,
          )
        ).rows;
        await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id,metadata)VALUES(${scope.personId}::uuid,'staff','patient.chart_history_read','patient',${patientId}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid,${JSON.stringify({ section, count: Math.min(rows.length, 25) })}::jsonb)`.execute(
          trx,
        );
        const last = rows[24];
        return {
          items: rows.slice(0, 25).map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            occurredAt: r.occurred_at.toISOString(),
            encounterId: r.encounter_id,
            encounter: r.encounter,
              note:r.note,
            ...(section === 'investigations' ? {diagnostic: r.diagnostic} : {}),
            fields: r.fields,
          })),
          nextCursor:
            rows.length > 25 && last
              ? Buffer.from(
                  JSON.stringify({ at: last.cursor_at, id: last.id }),
                ).toString('base64url')
              : null,
        };
      });
  }
}
