import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {StaffLabDutyOrder,StaffLabQueuePage,StaffLabCollection,StaffLabAccession,StaffLabResult,StaffLabResultInput,StaffLabVerification} from '@pulse/api-contracts';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import {staffCommand,commandEvidence} from '../../../platform/database/staff-command.js';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
import type {StaffLabWorkflowRepository} from '../domain/staff-lab-workflow.repository.js';
const states=['ordered','collected','accessioned','resulted'] as const;
const labelPattern=/^[A-Za-z0-9][A-Za-z0-9._/:-]{2,99}$/;
@Injectable()
export class KyselyStaffLabWorkflowRepository implements StaffLabWorkflowRepository {
  constructor(@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>){}
  private require(scope:PatientReadScope,action?:'lab:collect'|'lab:accession'|'lab:result'|'lab:verify'){
    if(!scope.privileges.includes('lab:read')||!scope.privileges.includes('lab:worklist')||(action&&!scope.privileges.includes(action)))throw new ForbiddenException({code:'ACCESS_DENIED',message:'This laboratory duty is unavailable for your account.'});
  }
  private scope(scope:PatientReadScope){return sql`p.facility_id=${scope.facilityId}::uuid AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)`;}
  private from(){return sql`FROM lab.lab_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id JOIN lab.test t ON t.id=r.test_id AND t.version=r.test_version`;}
  private select(scope:PatientReadScope){return sql`SELECT r.id,r.patient_id AS "patientId",r.encounter_id AS "encounterId",jsonb_build_object('type',e.type,'startedAt',e.started_at) AS encounter,e.status AS "encounterStatus",
    jsonb_build_object('id',p.id,'givenName',p.given_name,'familyName',p.family_name,'dateOfBirth',p.date_of_birth::text,'sex',p.sex,'status',p.status,'mrn',(SELECT i.value FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.system='urn:pulse:mrn:'||p.facility_id::text ORDER BY i.created_at,i.id LIMIT 1)) AS patient,
    jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'version',r.test_version,'specimenRequirement',t.specimen_requirement) AS test,
    r.urgency,r.indication,r.status,r.version,r.ordered_by AS "orderedBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.ordered_by ORDER BY c.created_at DESC LIMIT 1) AS "orderedByLabel",r.created_at::text AS "orderedAt",r.cancel_reason AS "cancelReason",r.cancelled_by AS "cancelledBy",r.cancelled_at::text AS "cancelledAt",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'container',s.container,'label',s.label,'collectedAt',s.collected_at,'collectedBy',s.collected_by,'identityConfirmed',s.identity_confirmed,'collectedByLabel',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=s.collected_by ORDER BY c.created_at DESC LIMIT 1),
      'accession',CASE WHEN a.specimen_id IS NOT NULL THEN jsonb_build_object('number',a.accession_number,'receivedAt',a.received_at,'receivedBy',a.received_by,'receivedByLabel',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=a.received_by ORDER BY c.created_at DESC LIMIT 1)) ELSE NULL END) ORDER BY s.collected_at,s.id)
      FROM lab.specimen s LEFT JOIN lab.specimen_accession a ON a.specimen_id=s.id AND a.facility_id=${scope.facilityId}::uuid WHERE s.order_id=r.id),'[]'::jsonb) AS specimens`;
  }
  private async audit(scope:PatientReadScope,id:string,action:string,resource='lab_order'){
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff',${action},${resource},${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);
  }
  async queue(scope:PatientReadScope,status:string,query:string,cursor?:string):Promise<StaffLabQueuePage>{
    this.require(scope);const q=query.trim();if(!['all',...states].includes(status)||q.length>100||(q.length>0&&q.length<2)||(cursor&&cursor.length>400))throw new BadRequestException('Choose valid laboratory queue filters.');
    let position:{rank:number;at:string;id:string}|undefined;
    if(cursor){try{position=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!position||![0,1,2].includes(position.rank)||typeof position.at!=='string'||!/^\d{4}-\d\d-\d\d[ T]/.test(position.at)||!Number.isFinite(Date.parse(position.at))||typeof position.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(position.id))throw new Error();}catch{throw new BadRequestException('Invalid laboratory queue page.');}}
    const rank=sql`CASE r.urgency WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END`;
    const pattern=q.replace(/[\\%_]/g,'\\$&')+'%';
    const filter=sql`${this.scope(scope)} AND r.status IN ('ordered','collected','accessioned','resulted') AND (${q===''} OR p.given_name ILIKE ${pattern} OR p.family_name ILIKE ${pattern} OR t.name ILIKE ${pattern}
      OR EXISTS(SELECT 1 FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.value=${q}))`;
    const result=await this.db.transaction().setIsolationLevel('repeatable read').execute(async trx=>{
      const counts=(await sql<{counts:StaffLabQueuePage['counts'];oldest:string|null}>`SELECT jsonb_build_object('ordered',count(*) FILTER(WHERE r.status='ordered'),'collected',count(*) FILTER(WHERE r.status='collected'),'accessioned',count(*) FILTER(WHERE r.status='accessioned'),'resulted',count(*) FILTER(WHERE r.status='resulted')) AS counts,min(r.created_at)::text AS oldest ${this.from()} WHERE ${filter}`.execute(trx)).rows[0]!;
      const rows=(await sql<StaffLabDutyOrder&{cursor_at:string;priority_rank:number}>`${this.select(scope)},r.created_at::text AS cursor_at,${rank} AS priority_rank ${this.from()} WHERE ${filter} ${status==='all'?sql``:sql`AND r.status=${status}`}
        ${position?sql`AND (${rank},r.created_at,r.id)>(${position.rank},${position.at}::timestamptz,${position.id}::uuid)`:sql``} ORDER BY ${rank},r.created_at,r.id LIMIT 26`.execute(trx)).rows;
      const last=rows[24];return {items:rows.slice(0,25).map(({cursor_at,priority_rank,...r})=>{void cursor_at;void priority_rank;return r;}),nextCursor:rows.length>25&&last?Buffer.from(JSON.stringify({rank:last.priority_rank,at:last.cursor_at,id:last.id})).toString('base64url'):null,counts:counts.counts,oldestPendingAt:counts.oldest,fetchedAt:new Date().toISOString()};
    });await this.audit(scope,scope.facilityId,'lab.queue_read','facility');return result;
  }
  async get(scope:PatientReadScope,id:string){
    this.require(scope);const row=(await sql<StaffLabDutyOrder>`${this.select(scope)} ${this.from()} WHERE r.id=${id}::uuid AND ${this.scope(scope)}`.execute(this.db)).rows[0];
    if(!row)throw new NotFoundException({code:'LAB_ORDER_NOT_FOUND',message:'This laboratory request is unavailable at the selected facility.'});
    if(scope.privileges.includes('lab:result')||scope.privileges.includes('lab:verify')){
      row.results=(await this.results(this.db,id)).rows;
      const verification=(await sql<{by:string|null;byLabel:string|null;at:string|null}>`SELECT verified_by AS by,verified_at::text AS at,(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.verified_by ORDER BY c.created_at DESC LIMIT 1) AS "byLabel" FROM lab.lab_order r WHERE id=${id}::uuid`.execute(this.db)).rows[0];
      row.verification=verification;
    }
    await this.audit(scope,id,'lab.duty_order_read');return row;
  }
  private results(db:Kysely<PulseDatabase>|Transaction<PulseDatabase>,id:string){
    return sql<StaffLabResult>`SELECT DISTINCT ON(lower(btrim(component))) id,component,value_text AS value,unit,flag,version,created_at::text AS "recordedAt",effective_at::text AS "effectiveAt",recorded_by AS "recordedBy",source,(SELECT c.login_id FROM iam.credential c WHERE c.person_id=v.recorded_by ORDER BY c.created_at DESC LIMIT 1) AS "recordedByLabel" FROM lab.result v WHERE order_id=${id}::uuid ORDER BY lower(btrim(component)),version DESC,created_at DESC,id DESC`.execute(db);
  }
  async result(scope:PatientReadScope,id:string,input:StaffLabResultInput){
    this.require(scope,'lab:result');
    const component=input.component.trim(),value=input.value.trim(),unit=input.unit.trim();
    if(!component||component.length>100||!value||value.length>2000||unit.length>50||input.attestation!==true||![null,'normal','high','low','critical'].includes(input.flag))throw new BadRequestException('Review the component, result, unit and interpretation before saving.');
    await staffCommand(this.db,scope,input.commandKey,'lab.result_staged',{id,...input},async trx=>{
      const order=await this.lock(trx,scope,id);
      if(order.version!==input.expectedVersion||!['accessioned','resulted'].includes(order.status)||order.patient_status!=='active')this.conflict();
      if((await sql`SELECT order_id FROM lab.critical_case WHERE order_id=${id}::uuid`.execute(trx)).rows.length)throw new ConflictException({code:'LAB_CRITICAL_REPORT_PINNED',message:'Critical communication has started. A governed correction is required to change these components.'});
      const received=(await sql<{at:Date}>`SELECT a.received_at AS at FROM lab.specimen_accession a JOIN lab.specimen s ON s.id=a.specimen_id WHERE s.order_id=${id}::uuid AND a.facility_id=${scope.facilityId}::uuid`.execute(trx)).rows;
      if(received.length!==1)this.conflict();
      const effectiveAt=this.time(input.effectiveAt,received[0]!.at);
      const previous=(await this.results(trx,id)).rows.find(r=>r.component.toLowerCase()===component.toLowerCase());
      // Preserve original spelling: downstream publication groups by exact component identity.
      await sql`INSERT INTO lab.result(order_id,component,value_text,unit,flag,version,recorded_by,effective_at,source)VALUES(${id}::uuid,${previous?.component??component},${value},${unit||null},${input.flag},${(previous?.version??0)+1},${scope.personId}::uuid,${effectiveAt}::timestamptz,'manual-bench')`.execute(trx);
      await sql`UPDATE lab.lab_order SET status='resulted',version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'lab_order',id,'lab.result_staged',{patientId:order.patient_id,encounterId:order.encounter_id,version:order.version+1,status:'resulted'});return {id};
    });return this.get(scope,id);
  }
  async verify(scope:PatientReadScope,id:string,input:StaffLabVerification){
    this.require(scope,'lab:verify');if(input.attestation!==true)throw new BadRequestException('Confirm final report review.');
    await staffCommand(this.db,scope,input.commandKey,'lab.verified',{id,...input},async trx=>{
      const order=await this.lock(trx,scope,id);
      if(order.version!==input.expectedVersion||order.status!=='resulted'||order.patient_status!=='active')this.conflict();
      const rows=(await this.results(trx,id)).rows;
      if(!rows.length||rows.some(r=>!r.recordedBy||!r.effectiveAt||r.source!=='manual-bench'))throw new ConflictException({code:'LAB_REVIEW_REQUIRED',message:'This report needs provenance reconciliation before release.'});
      if(rows.some(r=>r.recordedBy===scope.personId))throw new ForbiddenException({code:'LAB_INDEPENDENT_REVIEW_REQUIRED',message:'A different authorised laboratory verifier must review these results.'});
      if(rows.some(r=>r.flag==='critical')){
        const acknowledged=await sql`SELECT order_id FROM lab.critical_case WHERE order_id=${id}::uuid AND order_version=${order.version} AND acknowledged_at IS NOT NULL`.execute(trx);
        if(!acknowledged.rows.length)throw new ConflictException({code:'LAB_CRITICAL_RELEASE_HELD',message:'Confirm and communicate the critical finding, then obtain explicit acknowledgement from the responsible clinician before release.'});
      }
      await sql`UPDATE lab.lab_order SET status='verified',version=version+1,verified_by=${scope.personId}::uuid,verified_at=clock_timestamp() WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'lab_order',id,'lab.verified',{patientId:order.patient_id,encounterId:order.encounter_id,version:order.version+1,status:'verified'});return {id};
    });return this.get(scope,id);
  }
  private async lock(trx:Transaction<PulseDatabase>,scope:PatientReadScope,id:string){
    const row=(await sql<{patient_id:string;encounter_id:string;status:string;version:number;created_at:Date;patient_status:string;encounter_status:string}>`SELECT r.patient_id,r.encounter_id,r.status,r.version,r.created_at,p.status AS patient_status,e.status AS encounter_status ${this.from()} WHERE r.id=${id}::uuid AND ${this.scope(scope)} FOR UPDATE OF r`.execute(trx)).rows[0];
    if(!row)throw new NotFoundException('This laboratory request is unavailable at the selected facility.');
    await sql`SELECT e.id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id WHERE e.id=${row.encounter_id}::uuid AND p.id=${row.patient_id}::uuid FOR SHARE OF e,p`.execute(trx);
    // Re-read status after acquiring patient/encounter locks, including a concurrent closure/merge.
    const stable=(await sql<{patient_status:string;encounter_status:string}>`SELECT p.status AS patient_status,e.status AS encounter_status FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id WHERE e.id=${row.encounter_id}::uuid`.execute(trx)).rows[0]!;
    return {...row,...stable};
  }
  private time(value:string,earliest:Date){const time=new Date(value);if(!Number.isFinite(time.getTime())||time<earliest||time.getTime()>Date.now()+60_000)throw new BadRequestException({code:'LAB_SPECIMEN_TIME_INVALID',message:'Record an actual time after the preceding workflow event and no later than the current time.'});return time.toISOString();}
  private identifier(value:string){const v=value.trim();if(!labelPattern.test(v))throw new BadRequestException({code:'LAB_SPECIMEN_IDENTIFIER_INVALID',message:'Use a 3–100 character label or accession identifier with letters, numbers, dot, hyphen, slash, colon or underscore.'});return v;}
  private conflict():never{throw new ConflictException({code:'LAB_WORKFLOW_CHANGED',message:'This request has changed or is not eligible for this step. Your information is kept; review the latest order.'});}
  private async registerLabel(trx:Transaction<PulseDatabase>,scope:PatientReadScope,specimenId:string,label:string){
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`lab-label/${scope.facilityId}/${label.toLowerCase()}`},0))`.execute(trx);
    const duplicate=await sql`SELECT s.id FROM lab.specimen s JOIN lab.lab_order r ON r.id=s.order_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=r.patient_id AND e.facility_id=${scope.facilityId}::uuid WHERE lower(btrim(s.label))=lower(${label}) AND s.id<>${specimenId}::uuid LIMIT 1`.execute(trx);
    if(duplicate.rows.length)throw new ConflictException({code:'LAB_SPECIMEN_IDENTITY_CONFLICT',message:'That specimen label is already recorded at this facility. Verify the physical specimen and existing record.'});
    await sql`INSERT INTO lab.specimen_identity(specimen_id,facility_id,label)VALUES(${specimenId}::uuid,${scope.facilityId}::uuid,${label}) ON CONFLICT(specimen_id) DO NOTHING`.execute(trx);
  }
  async collect(scope:PatientReadScope,id:string,input:StaffLabCollection){
    this.require(scope,'lab:collect');const label=this.identifier(input.label),container=input.container.trim();if(container.length<3||container.length>100||input.identityConfirmed!==true)throw new BadRequestException('Confirm patient/label identity and record the specimen container.');
    await staffCommand(this.db,scope,input.commandKey,'lab.collected',{id,...input},async trx=>{
      const order=await this.lock(trx,scope,id);if(order.version!==input.expectedVersion||order.status!=='ordered'||order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status))this.conflict();
      const existing=await sql`SELECT id FROM lab.specimen WHERE order_id=${id}::uuid UNION ALL SELECT id FROM lab.result WHERE order_id=${id}::uuid LIMIT 1`.execute(trx);if(existing.rows.length)this.conflict();
      const collectedAt=this.time(input.collectedAt,order.created_at);
      const specimen=(await sql<{id:string}>`INSERT INTO lab.specimen(order_id,container,label,collected_at,collected_by,identity_confirmed)VALUES(${id}::uuid,${container},${label},${collectedAt}::timestamptz,${scope.personId}::uuid,true)RETURNING id`.execute(trx)).rows[0]!;
      await this.registerLabel(trx,scope,specimen.id,label);
      await sql`UPDATE lab.lab_order SET status='collected',version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'lab_order',id,'lab.collected',{patientId:order.patient_id,encounterId:order.encounter_id,specimenId:specimen.id,status:'collected',version:order.version+1});return {id};
    });return this.get(scope,id);
  }
  async accession(scope:PatientReadScope,id:string,input:StaffLabAccession){
    this.require(scope,'lab:accession');const number=this.identifier(input.accessionNumber);if(input.identityConfirmed!==true)throw new BadRequestException('Confirm the received specimen identity.');
    try{await staffCommand(this.db,scope,input.commandKey,'lab.accessioned',{id,...input},async trx=>{
      const order=await this.lock(trx,scope,id);if(order.version!==input.expectedVersion||order.status!=='collected'||order.patient_status!=='active')this.conflict();
      const specimens=(await sql<{id:string;label:string;collected_at:Date}>`SELECT id,label,collected_at FROM lab.specimen WHERE order_id=${id}::uuid FOR UPDATE`.execute(trx)).rows;
      if(specimens.length!==1||specimens[0]!.id!==input.specimenId)this.conflict();
      const specimen=specimens[0]!,receivedAt=this.time(input.receivedAt,specimen.collected_at);const label=this.identifier(specimen.label);
      await this.registerLabel(trx,scope,specimen.id,label);
      await sql`INSERT INTO lab.specimen_accession(specimen_id,facility_id,accession_number,received_at,received_by,identity_confirmed)VALUES(${specimen.id}::uuid,${scope.facilityId}::uuid,${number},${receivedAt}::timestamptz,${scope.personId}::uuid,true)`.execute(trx);
      await sql`UPDATE lab.lab_order SET status='accessioned',version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'lab_order',id,'lab.accessioned',{patientId:order.patient_id,encounterId:order.encounter_id,specimenId:specimen.id,status:'accessioned',version:order.version+1});return {id};
    });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException({code:'LAB_SPECIMEN_IDENTITY_CONFLICT',message:'That specimen or accession identifier is already recorded. Review the existing record.'});throw e;}
    return this.get(scope,id);
  }
}
