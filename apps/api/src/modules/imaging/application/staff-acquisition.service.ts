import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {StaffImagingAcquisition,StaffImagingAcquisitionInput,StaffImagingAcquisitionConfirm,StaffImagingAcquisitionTemplate} from '@pulse/api-contracts';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import {staffCommand,commandEvidence} from '../../../platform/database/staff-command.js';
import {PACS_GATEWAY,type PacsGateway} from '../domain/pacs.gateway.js';
@Injectable()
export class StaffAcquisitionService {
 constructor(@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>,@Inject(PACS_GATEWAY) private readonly pacs:PacsGateway){}
 private access(scope:PatientReadScope,write=false){if(!['patient:read','imaging:view','imaging:worklist',...(write?['imaging:acquire']:[])].every(p=>scope.privileges.includes(p)))throw new ForbiddenException('Radiology acquisition permission is required.');}
 private scoped(scope:PatientReadScope){return sql`p.facility_id=${scope.facilityId}::uuid AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)`;}
 private from(){return sql`FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id`;}
 private currentTemplate(scope:PatientReadScope){return sql`t.active AND ft.active AND ft.facility_id=${scope.facilityId}::uuid AND NOT EXISTS(SELECT 1 FROM img.acquisition_template n JOIN img.facility_acquisition_template nf ON nf.template_id=n.id AND nf.facility_id=ft.facility_id AND nf.active WHERE n.code=t.code AND n.version>t.version AND n.active)`;}
 private templateSelect(){return sql`SELECT t.id,t.code,t.name,t.version,t.dicom_modality AS "dicomModality",t.instructions,t.policy_reference AS "policyReference",t.checks FROM img.acquisition_template t JOIN img.facility_acquisition_template ft ON ft.template_id=t.id`;}
 async get(scope:PatientReadScope,id:string):Promise<StaffImagingAcquisition>{
  this.access(scope);
  const order=(await sql<{procedure_id:string}>`SELECT r.procedure_id ${this.from()} WHERE r.id=${id}::uuid AND ${this.scoped(scope)}`.execute(this.db)).rows[0];if(!order)throw new NotFoundException('Imaging request unavailable.');
  const templates=(await sql<StaffImagingAcquisitionTemplate>`${this.templateSelect()} WHERE t.procedure_id=${order.procedure_id}::uuid AND ${this.currentTemplate(scope)} ORDER BY t.name,t.id`.execute(this.db)).rows;
  const workItem=(await sql<NonNullable<StaffImagingAcquisition['workItem']>>`SELECT c.id,c.study_uid AS "studyUid",c.accession,c.patient_id_value AS "patientId",c.issuer,c.birth_date AS "birthDate",c.dicom_modality AS "dicomModality",c.responses,c.reason,c.created_at::text AS "preparedAt",(SELECT login_id FROM iam.credential WHERE person_id=c.prepared_by ORDER BY created_at DESC LIMIT 1) AS "preparedByLabel",
  jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'version',t.version,'dicomModality',t.dicom_modality,'instructions',t.instructions,'policyReference',t.policy_reference,'checks',t.checks) AS template,
  CASE WHEN done.case_id IS NULL THEN NULL ELSE jsonb_build_object('studyId',done.study_id,'seriesCount',done.series_count,'instanceCount',done.instance_count,'verifiedAt',done.created_at,'reason',done.reason,'verifiedByLabel',(SELECT login_id FROM iam.credential WHERE person_id=done.verified_by ORDER BY created_at DESC LIMIT 1)) END AS completion
  FROM img.acquisition_case c JOIN img.acquisition_template t ON t.id=c.template_id AND t.version=c.template_version LEFT JOIN img.acquisition_completion done ON done.case_id=c.id WHERE c.order_id=${id}::uuid`.execute(this.db)).rows[0]??null;
  await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','imaging.acquisition_read','imaging_order',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);
  return {templates,workItem};
 }
 private async prerequisites(trx:Transaction<PulseDatabase>,scope:PatientReadScope,id:string,version:number,status:'scheduled'|'protocolled'){
  const order=(await sql<{version:number;status:string;procedure_id:string;mrn:string|null;birth_date:string;patient_status:string;encounter_status:string}>`SELECT r.version,r.status,r.procedure_id,p.status AS patient_status,e.status AS encounter_status,to_char(p.date_of_birth,'YYYYMMDD') AS birth_date,(SELECT value FROM patient.identifier WHERE patient_id=p.id AND facility_id=p.facility_id AND system='urn:pulse:mrn:'||p.facility_id::text ORDER BY created_at DESC LIMIT 1) AS mrn ${this.from()} WHERE r.id=${id}::uuid AND ${this.scoped(scope)} FOR UPDATE OF r FOR SHARE OF p,e`.execute(trx)).rows[0];
  if(!order)throw new NotFoundException('Imaging request unavailable.');
  if(order.version!==version||order.status!==status||order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status))throw new ConflictException('The request or encounter changed. Reload before continuing.');
  if((await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(trx)).rows.length)throw new ConflictException('Processing already exists. Reload the request.');
  const booking=(await sql<{booking_id:string}>`SELECT res.booking_id FROM img.schedule_reservation res JOIN img.schedule_booking b ON b.id=res.booking_id JOIN img.booking_arrival a ON a.booking_id=b.id JOIN img.schedule_slot slot ON slot.id=res.slot_id JOIN img.schedule_resource resource ON resource.id=slot.resource_id JOIN img.protocol_review review ON review.id=b.protocol_review_id JOIN img.protocol_template t ON t.id=review.template_id AND t.version=review.template_version JOIN img.facility_protocol fp ON fp.template_id=t.id AND fp.facility_id=${scope.facilityId}::uuid
  WHERE res.order_id=${id}::uuid AND slot.active AND resource.active AND NOT resource.blocked AND resource.facility_id=${scope.facilityId}::uuid AND review.decision='approved' AND review.order_version=(SELECT max(order_version) FROM img.protocol_review WHERE order_id=${id}::uuid) AND t.active AND fp.active AND NOT EXISTS(SELECT 1 FROM img.protocol_template n JOIN img.facility_protocol nf ON nf.template_id=n.id AND nf.facility_id=fp.facility_id AND nf.active WHERE n.code=t.code AND n.version>t.version AND n.active) FOR SHARE OF slot,resource,t,fp`.execute(trx)).rows[0];
  if(!booking)throw new ConflictException('A verified arrival, current booked protocol approval and available resource are required.');
  return {...order,bookingId:booking.booking_id};
 }
 private reason(input:StaffImagingAcquisitionConfirm){if(input.attestation!==true||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>2000)throw new BadRequestException('Review the acquisition and record a handover note.');}
 async prepare(scope:PatientReadScope,id:string,input:StaffImagingAcquisitionInput){
  this.access(scope,true);this.reason(input);
  await staffCommand(this.db,scope,input.commandKey,'imaging.acquisition_prepared',{id,...input},async trx=>{
   const order=await this.prerequisites(trx,scope,id,input.expectedVersion,'scheduled');
   const template=(await sql<StaffImagingAcquisitionTemplate>`${this.templateSelect()} WHERE t.id=${input.templateId}::uuid AND t.version=${input.templateVersion} AND t.procedure_id=${order.procedure_id}::uuid AND ${this.currentTemplate(scope)} FOR SHARE OF t,ft`.execute(trx)).rows[0];
   if(!template)throw new ConflictException('Choose a current facility acquisition checklist.');
   const checks=template.checks;if(!Array.isArray(checks)||!checks.length||checks.length>30||checks.some(c=>!c||typeof c.key!=='string'||!c.key||typeof c.label!=='string'||typeof c.allowNotApplicable!=='boolean')||new Set(checks.map(c=>c.key)).size!==checks.length)throw new ConflictException('The facility checklist configuration needs review.');
   const responses=input.responses;if(!responses||typeof responses!=='object'||Array.isArray(responses)||Object.keys(responses).length!==checks.length||checks.some(c=>{const r=responses[c.key];return !r||!['clear',...(c.allowNotApplicable?['not-applicable']:[])].includes(r.outcome)||typeof r.note!=='string'||r.note.length>1000||(r.outcome==='not-applicable'&&r.note.trim().length<3)||Object.keys(r).some(k=>!['outcome','note'].includes(k));}))throw new BadRequestException('Resolve every procedure-day check before preparing acquisition. Concerns and unknowns must be resolved through the facility process.');
   if(!order.mrn||order.mrn.length>64)throw new ConflictException('A valid facility MRN is required for the acquisition work item.');
   const caseId=randomUUID(),studyUid='2.25.'+BigInt('0x'+randomUUID().replaceAll('-','')).toString(),accession='P'+randomUUID().replaceAll('-','').slice(0,15),issuer='PULSE:'+scope.facilityId;
   await sql`INSERT INTO img.acquisition_case(id,order_id,booking_id,template_id,template_version,order_version,study_uid,accession,patient_id_value,issuer,birth_date,dicom_modality,responses,reason,prepared_by)VALUES(${caseId}::uuid,${id}::uuid,${order.bookingId}::uuid,${template.id}::uuid,${template.version},${order.version},${studyUid},${accession},${order.mrn},${issuer},${order.birth_date},${template.dicomModality},${JSON.stringify(responses)}::jsonb,${input.reason.trim()},${scope.personId}::uuid)`.execute(trx);
   await sql`UPDATE img.img_order SET status='protocolled',version=version+1 WHERE id=${id}::uuid`.execute(trx);
   await commandEvidence(trx,scope,'imaging_order',id,'imaging.acquisition_prepared',{caseId,version:order.version+1});return {caseId};
  });return this.get(scope,id);
 }
 async confirm(scope:PatientReadScope,id:string,input:StaffImagingAcquisitionConfirm){
  this.access(scope,true);this.reason(input);
  await staffCommand(this.db,scope,input.commandKey,'imaging.acquired',{id,...input},async trx=>{
   const order=await this.prerequisites(trx,scope,id,input.expectedVersion,'protocolled');
   const work=(await sql<{id:string;booking_id:string;template_id:string;template_version:number;studyUid:string;patientId:string;issuer:string;accession:string;modality:string;birthDate:string|null}>`SELECT id,booking_id,template_id,template_version,study_uid AS "studyUid",patient_id_value AS "patientId",issuer,accession,dicom_modality AS modality,birth_date AS "birthDate" FROM img.acquisition_case WHERE order_id=${id}::uuid`.execute(trx)).rows[0];
   if(!work||work.booking_id!==order.bookingId||work.patientId!==order.mrn||work.birthDate!==order.birth_date)throw new ConflictException('The acquisition work item or patient identifiers changed. Reconciliation is required.');
   if(!(await sql`${this.templateSelect()} WHERE t.id=${work.template_id}::uuid AND t.version=${work.template_version} AND ${this.currentTemplate(scope)} FOR SHARE OF t,ft`.execute(trx)).rows.length)throw new ConflictException('The procedure-day checklist changed. Governed reconciliation is required.');
   const verified=await this.pacs.verifyStudy(work);
   if(!verified.verified)throw new ConflictException({code:verified.reason==='not-found'?'IMAGING_STUDY_NOT_RECEIVED':verified.reason==='identity-mismatch'?'IMAGING_STUDY_IDENTITY_MISMATCH':'IMAGING_STUDY_UNVERIFIED',message:'The expected study could not be verified. No acquisition was recorded.'});
   const studyId=randomUUID();
   await sql`INSERT INTO img.study(id,order_id,study_uid,accession,modality,pacs_ref)VALUES(${studyId}::uuid,${id}::uuid,${work.studyUid},${work.accession},${work.modality},${'orthanc:dicomweb:'+work.studyUid})`.execute(trx);
   await sql`INSERT INTO img.acquisition_completion(case_id,study_id,series_count,instance_count,reason,verified_by)VALUES(${work.id}::uuid,${studyId}::uuid,${verified.seriesCount},${verified.instanceCount},${input.reason.trim()},${scope.personId}::uuid)`.execute(trx);
   await sql`UPDATE img.img_order SET status='acquired',version=version+1 WHERE id=${id}::uuid`.execute(trx);
   await commandEvidence(trx,scope,'imaging_order',id,'imaging.acquired',{caseId:work.id,studyId,version:order.version+1});return {studyId};
  });return this.get(scope,id);
 }
}
