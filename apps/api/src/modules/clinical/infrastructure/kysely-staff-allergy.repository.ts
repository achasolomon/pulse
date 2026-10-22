import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {StaffAllergy,StaffAllergyReview,StaffAllergyInput,StaffAllergyReviewInput,StaffAllergyCorrectionInput} from '@pulse/api-contracts';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import {staffCommand,commandEvidence} from '../../../platform/database/staff-command.js';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
import type {StaffAllergyRepository} from '../domain/staff-allergy.repository.js';
@Injectable()
export class KyselyStaffAllergyRepository implements StaffAllergyRepository {
  constructor(@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>){}
  private require(scope:PatientReadScope,write=false){
    if(!scope.privileges.includes('entry:read')||(write&&!scope.privileges.includes('allergy:write')))throw new ForbiddenException({code:'ACCESS_DENIED',message:'Your account cannot perform this allergy action.'});
  }
  private care(scope:PatientReadScope,patientId:string){return sql`EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=${patientId}::uuid AND a.facility_id=${scope.facilityId}::uuid AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))`;}
  private async contexts(db:Kysely<PulseDatabase>|Transaction<PulseDatabase>,scope:PatientReadScope,patientId:string){
    if(!scope.privileges.includes('allergy:write'))return [];
    const rows=await sql<{id:string;type:string;started_at:Date}>`SELECT e.id,e.type,e.started_at FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id
      LEFT JOIN encounter.outpatient_visit v ON v.encounter_id=e.id AND v.facility_id=e.facility_id AND v.patient_id=p.id
      WHERE e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid AND p.status='active' AND e.status IN ('open','admitted')
      AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=e.facility_id AND a.encounter_id=e.id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))
      AND ((e.type='outpatient' AND ((${scope.privileges.includes('encounter:consult')} AND v.clinician_person_id=${scope.personId}::uuid AND v.stage='in-consultation') OR (${scope.privileges.includes('note:nursing')} AND v.nurse_person_id=${scope.personId}::uuid AND v.stage IN ('vitals-in-progress','vitals-recorded','waiting-consultation','in-consultation')))) OR (e.type IN ('inpatient','emergency') AND ${scope.privileges.includes('encounter:consult')||scope.privileges.includes('note:nursing')}))
      ORDER BY e.started_at DESC,e.id DESC LIMIT 100`.execute(db);
    return rows.rows.map(r=>({encounterId:r.id,type:r.type,startedAt:r.started_at.toISOString()}));
  }
  private async snapshot(db:Kysely<PulseDatabase>|Transaction<PulseDatabase>,scope:PatientReadScope,patientId:string){
    const patient=await sql`SELECT p.id FROM patient.patient p JOIN org.facility f ON f.id=p.facility_id WHERE p.id=${patientId}::uuid AND p.facility_id=${scope.facilityId}::uuid AND f.organization_id=${scope.organizationId}::uuid AND ${this.care(scope,patientId)}`.execute(db);
    if(!patient.rows.length)throw new NotFoundException('This allergy record is unavailable in your care context.');
    const items=(await sql<StaffAllergy>`SELECT n.id,n.display AS substance,n.status,n.origin,n.version,n.encounter_id AS "encounterId",n.verification_status AS "verificationStatus",n.recorded_at::text AS "recordedAt",n.recorded_by AS "recordedBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=n.recorded_by ORDER BY c.created_at DESC LIMIT 1) AS "recordedByLabel",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=d.corrected_by ORDER BY c.created_at DESC LIMIT 1) AS "correctedByLabel",
      d.category,d.allergy_type AS type,d.reaction,d.severity,d.criticality,d.information_source AS "informationSource",d.correction_reason AS "correctionReason",d.corrected_at::text AS "correctedAt",d.corrected_by AS "correctedBy"
      FROM clin.entry n LEFT JOIN clin.allergy_detail d ON d.entry_id=n.id WHERE n.patient_id=${patientId}::uuid AND n.kind='allergy'
      AND (n.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=n.encounter_id AND e.patient_id=n.patient_id AND e.facility_id=${scope.facilityId}::uuid)) ORDER BY n.recorded_at DESC,n.id DESC LIMIT 1001`.execute(db)).rows;
    if(items.length>1000)throw new ConflictException('This allergy record requires specialist reconciliation before it can be edited here.');
    const latestReview=(await sql<StaffAllergyReview>`SELECT r.id,r.status,r.information_source AS "informationSource",r.reason,r.reviewed_by AS "reviewedBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.reviewed_by ORDER BY c.created_at DESC LIMIT 1) AS "reviewedByLabel",r.reviewed_at::text AS "reviewedAt",r.encounter_id AS "encounterId" FROM clin.allergy_review r JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=r.patient_id AND e.facility_id=${scope.facilityId}::uuid WHERE r.patient_id=${patientId}::uuid ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1`.execute(db)).rows[0]??null;
    return {items,latestReview,revision:createHash('sha256').update(JSON.stringify({items,latestReview})).digest('hex')};
  }
  async read(scope:PatientReadScope,patientId:string){
    this.require(scope);
    const result=await this.db.transaction().setIsolationLevel('repeatable read').execute(async trx=>({...await this.snapshot(trx,scope,patientId),contexts:await this.contexts(trx,scope,patientId)}));
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','allergy.read','patient',${patientId}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);
    const latestChange=Math.max(0,...result.items.flatMap(i=>[Date.parse(i.recordedAt),i.correctedAt?Date.parse(i.correctedAt):0]));
    const reviewStatus:import('@pulse/api-contracts').StaffAllergyRecord['reviewStatus']=result.items.some(i=>i.status==='active')?'allergies-recorded':result.latestReview&&Date.parse(result.latestReview.reviewedAt)>=latestChange?result.latestReview.status:'unknown';
    return {...result,reviewStatus};
  }
  private async lock(trx:Transaction<PulseDatabase>,scope:PatientReadScope,patientId:string,input:{encounterId:string;expectedRevision:string}){
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`allergies/${patientId}`},0))`.execute(trx);
    await sql`SELECT id FROM iam.care_assignment WHERE person_id=${scope.personId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND encounter_id=${input.encounterId}::uuid FOR SHARE`.execute(trx);
    await sql`SELECT encounter_id FROM encounter.outpatient_visit WHERE encounter_id=${input.encounterId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid FOR SHARE`.execute(trx);
    await sql`SELECT e.id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id WHERE e.id=${input.encounterId}::uuid AND e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid FOR SHARE OF e,p`.execute(trx);
    if(!(await this.contexts(trx,scope,patientId)).some(c=>c.encounterId===input.encounterId))throw new ForbiddenException({code:'ALLERGY_ENCOUNTER_NOT_ASSIGNED',message:'An active encounter assigned to you is required for allergy reconciliation.'});
    await sql`SELECT id FROM clin.entry WHERE patient_id=${patientId}::uuid AND kind='allergy' FOR UPDATE`.execute(trx);
    const current=await this.snapshot(trx,scope,patientId);
    if(current.revision!==input.expectedRevision)throw new ConflictException({code:'ALLERGY_REVISION_CONFLICT',message:'The allergy record has changed. Your text is retained; close and review the latest list before saving.'});
    return current;
  }
  async add(scope:PatientReadScope,patientId:string,input:StaffAllergyInput){
    this.require(scope,true);
    if(input.verificationStatus==='confirmed'&&!scope.privileges.includes('encounter:consult'))throw new ForbiddenException('Only an authorised treating clinician can confirm an allergy.');
    const substance=input.substance.trim(),reaction=input.reaction.trim();
    if(substance.length<3||substance.length>300||reaction.length<3||reaction.length>2000)throw new BadRequestException('Enter the substance and recorded reaction, or state that the reaction is unknown.');
    await staffCommand(this.db,scope,input.commandKey,'allergy.recorded',{patientId,...input},async trx=>{
      const current=await this.lock(trx,scope,patientId,input);
      if(current.items.some(i=>i.status==='active'&&i.substance.trim().toLocaleLowerCase()===substance.toLocaleLowerCase()))throw new ConflictException({code:'ALLERGY_DUPLICATE',message:'This substance already has an active allergy record. Review it before adding another.'});
      const row=(await sql<{id:string}>`INSERT INTO clin.entry(patient_id,encounter_id,kind,display,verification_status,recorded_by)VALUES(${patientId}::uuid,${input.encounterId}::uuid,'allergy',${substance},${input.verificationStatus},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!;
      await sql`INSERT INTO clin.allergy_detail(entry_id,category,allergy_type,reaction,severity,criticality,information_source)VALUES(${row.id}::uuid,${input.category},${input.type},${reaction},${input.severity},${input.criticality},${input.informationSource})`.execute(trx);
      await commandEvidence(trx,scope,'entry',row.id,'allergy.recorded',{patientId,encounterId:input.encounterId,version:1});return {id:row.id};
    });
    return this.read(scope,patientId);
  }
  async review(scope:PatientReadScope,patientId:string,input:StaffAllergyReviewInput){
    this.require(scope,true);const reason=input.reason.trim();if(reason.length<3||reason.length>2000||input.attestation!==true)throw new BadRequestException('Record the review evidence and confirm that you reviewed the allergy list.');
    await staffCommand(this.db,scope,input.commandKey,'allergy.reviewed',{patientId,...input},async trx=>{
      const current=await this.lock(trx,scope,patientId,input),active=current.items.filter(i=>i.status==='active');
      if((input.status==='no-known-allergies'&&active.length)||(input.status==='no-known-drug-allergies'&&active.some(i=>!i.category||['medication','unknown'].includes(i.category))))throw new ConflictException({code:'ALLERGY_NEGATIVE_CONFLICT',message:'This declaration conflicts with active allergy records. Review those entries first.'});
      const row=(await sql<{id:string}>`INSERT INTO clin.allergy_review(patient_id,encounter_id,status,information_source,reason,reviewed_by)VALUES(${patientId}::uuid,${input.encounterId}::uuid,${input.status},${input.informationSource},${reason},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!;
      await commandEvidence(trx,scope,'allergy_review',row.id,'allergy.reviewed',{patientId,encounterId:input.encounterId});return {id:row.id};
    });
    return this.read(scope,patientId);
  }
  async correct(scope:PatientReadScope,patientId:string,id:string,input:StaffAllergyCorrectionInput){
    this.require(scope,true);if(!scope.privileges.includes('allergy:correct')||!scope.privileges.includes('encounter:consult'))throw new ForbiddenException('Only an authorised treating clinician can correct an allergy entry.');
    const reason=input.reason.trim();if(reason.length<3||reason.length>2000)throw new BadRequestException('Enter a correction reason.');
    await staffCommand(this.db,scope,input.commandKey,'allergy.entered-in-error',{patientId,id,...input},async trx=>{
      const current=await this.lock(trx,scope,patientId,input),entry=current.items.find(i=>i.id===id&&i.status==='active'&&i.origin==='local');
      if(!entry)throw new NotFoundException('Only an active local allergy entry can be corrected here.');
      // The source fields stay unchanged; correction metadata is separate. Legacy descriptions stay visible.
      await sql`INSERT INTO clin.allergy_detail(entry_id,category,allergy_type,reaction,severity,criticality,information_source,correction_reason,corrected_by,corrected_at,correction_encounter_id)
        VALUES(${id}::uuid,'unknown','unknown','Not recorded','unknown','unable-to-assess','clinical-record',${reason},${scope.personId}::uuid,now(),${input.encounterId}::uuid)
        ON CONFLICT(entry_id) DO UPDATE SET correction_reason=EXCLUDED.correction_reason,corrected_by=EXCLUDED.corrected_by,corrected_at=EXCLUDED.corrected_at,correction_encounter_id=EXCLUDED.correction_encounter_id`.execute(trx);
      await sql`UPDATE clin.entry SET status='resolved',version=version+1 WHERE id=${id}::uuid AND patient_id=${patientId}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'entry',id,'allergy.entered-in-error',{patientId,encounterId:input.encounterId,version:entry.version+1});return {id};
    });
    return this.read(scope,patientId);
  }
}
