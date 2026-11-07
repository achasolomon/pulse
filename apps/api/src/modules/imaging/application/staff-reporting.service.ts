import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {StaffImagingReportInput,StaffImagingReportSignoff,StaffImagingReporting,StaffImagingReportContent} from '@pulse/api-contracts';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import {staffCommand,commandEvidence} from '../../../platform/database/staff-command.js';
@Injectable()
export class StaffReportingService {
 constructor(@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>){}
 private access(scope:PatientReadScope,write?:'report'|'finalize'){if(!['patient:read','imaging:view','imaging:worklist',...(write?['imaging:'+write]:[])].every(p=>scope.privileges.includes(p)))throw new ForbiddenException({code:'ACCESS_DENIED',message:'Reporting permission is required.'});}
 private from(){return sql`FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id`;}
 private scope(scope:PatientReadScope){return sql`p.facility_id=${scope.facilityId}::uuid AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)`;}
 async get(scope:PatientReadScope,id:string):Promise<StaffImagingReporting>{
  this.access(scope);if(!(await sql`SELECT r.id ${this.from()} WHERE r.id=${id}::uuid AND ${this.scope(scope)}`.execute(this.db)).rows.length)throw new NotFoundException('Imaging request unavailable.');
  const study=(await sql<NonNullable<StaffImagingReporting['study']>>`SELECT s.id,s.study_uid AS "studyUid",s.accession,s.modality FROM img.study s JOIN img.acquisition_completion done ON done.study_id=s.id WHERE s.order_id=${id}::uuid`.execute(this.db)).rows[0]??null;
  const reports=(await sql<StaffImagingReporting['reports'][number]>`SELECT rp.id,rp.version,rp.status,d.content,d.priority,d.reason,d.supersedes_id AS "supersedesId",rp.author_id AS "authorId",(SELECT login_id FROM iam.credential WHERE person_id=rp.author_id ORDER BY created_at DESC LIMIT 1) AS "authorLabel",rp.created_at::text AS "createdAt",CASE WHEN sign.report_id IS NULL THEN NULL ELSE jsonb_build_object('verifiedByLabel',(SELECT login_id FROM iam.credential WHERE person_id=sign.verified_by ORDER BY created_at DESC LIMIT 1),'verifiedAt',sign.created_at,'reviewReference',sign.review_reference,'reason',sign.reason) END AS signoff FROM img.report rp JOIN img.staff_report_detail d ON d.report_id=rp.id LEFT JOIN img.report_signoff sign ON sign.report_id=rp.id WHERE rp.order_id=${id}::uuid ORDER BY rp.version DESC,rp.id DESC LIMIT 100`.execute(this.db)).rows;
  await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','imaging.reports_read','imaging_order',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);return {study,reports};
 }
 private async lock(trx:Transaction<PulseDatabase>,scope:PatientReadScope,id:string,version:number){
  const order=(await sql<{version:number;status:string;patient_status:string}>`SELECT r.version,r.status,p.status AS patient_status ${this.from()} WHERE r.id=${id}::uuid AND ${this.scope(scope)} FOR UPDATE OF r FOR SHARE OF p`.execute(trx)).rows[0];
  if(!order)throw new NotFoundException('Imaging request unavailable.');
  if(order.version!==version||!['acquired','reported'].includes(order.status)||order.patient_status!=='active')throw new ConflictException({code:'IMAGING_REPORT_CHANGED',message:'Reload the current report/request.'});return order;
 }
 private latest(trx:Transaction<PulseDatabase>,id:string){return sql<{id:string;version:number;status:string}>`SELECT id,version,status FROM img.report WHERE order_id=${id}::uuid ORDER BY version DESC,created_at DESC,id DESC LIMIT 1`.execute(trx).then(r=>r.rows[0]);}
 async save(scope:PatientReadScope,id:string,input:StaffImagingReportInput){
  this.access(scope,'report');const fields=['technique','comparison','findings','impression','recommendations'] as const;
  if(typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>2000||!['routine','urgent','critical'].includes(input.priority)||!input.content||typeof input.content!=='object'||Array.isArray(input.content)||Object.keys(input.content).length!==fields.length||fields.some(k=>typeof input.content[k]!=='string'||input.content[k].length>10000)||!fields.some(k=>input.content[k].trim())||fields.reduce((n,k)=>n+input.content[k].length,0)>30000)throw new BadRequestException({code:'IMAGING_REPORT_CONTENT_REQUIRED',message:'Enter valid structured report content and a revision reason.'});
  const content=Object.fromEntries(fields.map(k=>[k,input.content[k].trim()])) as unknown as StaffImagingReportContent;
  await staffCommand(this.db,scope,input.commandKey,'imaging.report_drafted',{id,...input},async trx=>{
   const order=await this.lock(trx,scope,id,input.expectedVersion),latest=await this.latest(trx,id);
   if((await sql`SELECT order_id FROM img.critical_case WHERE order_id=${id}::uuid`.execute(trx)).rows.length)throw new ConflictException({code:'IMAGING_REPORT_PINNED',message:'Communication pins this report; governed correction is required.'});
   if((latest?.id??null)!==input.expectedReportId||latest?.status==='final')throw new ConflictException({code:'IMAGING_REPORT_CHANGED',message:'The latest report changed.'});
   if(latest){const previous=(await sql<{priority:string}>`SELECT priority FROM img.staff_report_detail WHERE report_id=${latest.id}::uuid`.execute(trx)).rows[0];if(previous&&previous.priority!=='routine'&&input.priority!==previous.priority)throw new ConflictException({code:'IMAGING_REPORT_COMMUNICATION_HELD',message:'Urgent/critical reclassification requires governed reconciliation.'});}
   const study=(await sql`SELECT s.id FROM img.study s JOIN img.acquisition_completion done ON done.study_id=s.id WHERE s.id=${input.studyId}::uuid AND s.order_id=${id}::uuid FOR SHARE OF s,done`.execute(trx)).rows[0];if(!study)throw new ConflictException({code:'IMAGING_REPORT_STUDY_REQUIRED',message:'A verified linked study is required.'});
   const reportId=randomUUID(),reportVersion=(latest?.version??0)+1;
   const text=fields.map(k=>k[0]!.toUpperCase()+k.slice(1)+'\n'+(content[k]||'Not documented')).join('\n\n');
   await sql`INSERT INTO img.report(id,order_id,text,status,version,author_id)VALUES(${reportId}::uuid,${id}::uuid,${text},'draft',${reportVersion},${scope.personId}::uuid)`.execute(trx);
   await sql`INSERT INTO img.staff_report_detail(report_id,study_id,content,priority,reason,supersedes_id)VALUES(${reportId}::uuid,${input.studyId}::uuid,${JSON.stringify(content)}::jsonb,${input.priority},${input.reason.trim()},${latest?.id??null}::uuid)`.execute(trx);
   await sql`UPDATE img.img_order SET status='reported',version=version+1 WHERE id=${id}::uuid`.execute(trx);
   await commandEvidence(trx,scope,'imaging_order',id,'imaging.report_drafted',{reportId,reportVersion,version:order.version+1});return {reportId};
  });return this.get(scope,id);
 }
 async sign(scope:PatientReadScope,id:string,input:StaffImagingReportSignoff){
  this.access(scope,'finalize');if(input.attestation!==true||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>2000||typeof input.reviewReference!=='string'||input.reviewReference.trim().length<3||input.reviewReference.length>500)throw new BadRequestException({code:'IMAGING_REPORT_REVIEW_REQUIRED',message:'Review the images and report, then attest sign-off.'});
  await staffCommand(this.db,scope,input.commandKey,'imaging.finalized',{id,...input},async trx=>{
   const order=await this.lock(trx,scope,id,input.expectedVersion),latest=await this.latest(trx,id);
   if(order.status!=='reported'||latest?.id!==input.reportId||latest.status!=='draft')throw new ConflictException({code:'IMAGING_REPORT_CHANGED',message:'The report changed.'});
   const detail=(await sql<{priority:string;content:StaffImagingReportContent}>`SELECT d.priority,d.content FROM img.staff_report_detail d JOIN img.study s ON s.id=d.study_id AND s.order_id=${id}::uuid JOIN img.acquisition_completion done ON done.study_id=s.id WHERE d.report_id=${input.reportId}::uuid FOR SHARE OF s,done`.execute(trx)).rows[0];
   if(!detail||!detail.content.findings.trim()||!detail.content.impression.trim())throw new BadRequestException({code:'IMAGING_REPORT_CONTENT_REQUIRED',message:'Findings and impression are required before final sign-off.'});
   if(detail.priority!=='routine'&&!(await sql`SELECT order_id FROM img.critical_case WHERE order_id=${id}::uuid AND report_id=${input.reportId}::uuid AND order_version=${order.version} AND acknowledged_at IS NOT NULL`.execute(trx)).rows.length)throw new ConflictException({code:'IMAGING_REPORT_COMMUNICATION_HELD',message:'Accountable communication and acknowledgement are required before release.'});
   await sql`INSERT INTO img.report_signoff(report_id,verified_by,review_reference,reason)VALUES(${input.reportId}::uuid,${scope.personId}::uuid,${input.reviewReference.trim()},${input.reason.trim()})`.execute(trx);
   await sql`UPDATE img.report SET status='final' WHERE id=${input.reportId}::uuid`.execute(trx);
   await sql`UPDATE img.img_order SET status='final',version=version+1 WHERE id=${id}::uuid`.execute(trx);
   await commandEvidence(trx,scope,'imaging_order',id,'imaging.finalized',{reportId:input.reportId,reportVersion:latest.version,version:order.version+1});return {reportId:input.reportId};
  });return this.get(scope,id);
 }
}
