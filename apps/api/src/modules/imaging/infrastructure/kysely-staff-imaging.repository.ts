import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type {
  StaffImagingProcedure,
  StaffImagingOrder,
  StaffImagingOrderInput,
  StaffLabCancellation,
} from '@pulse/api-contracts';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import {
  staffCommand,
  commandEvidence,
} from '../../../platform/database/staff-command.js';
import type { PatientReadScope } from '../../patient/domain/staff-patient-read.repository.js';
import type { StaffImagingRepository } from '../domain/staff-imaging.repository.js';
@Injectable()
export class KyselyStaffImagingRepository implements StaffImagingRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  private schedulePrivilege(scope:PatientReadScope,action='imaging:schedule'){this.duty(scope);if(!scope.privileges.includes(action))throw new ForbiddenException({code:'ACCESS_DENIED',message:'Radiology scheduling permission is required.'});}
  private slotSelect(){return sql`SELECT s.id,s.starts_at::text AS "startsAt",s.ends_at::text AS "endsAt",r.id AS "resourceId",r.name AS "resourceName",r.location,r.modality FROM img.schedule_slot s JOIN img.schedule_resource r ON r.id=s.resource_id`;}
  async readiness(scope:PatientReadScope,id:string):Promise<import('@pulse/api-contracts').StaffImagingReadiness>{
    this.duty(scope);
    const facts=(await sql<{request:boolean;booking:boolean;arrival:boolean;protocol:boolean;resource:boolean}>`SELECT
    (r.status='scheduled' AND p.status='active' AND e.status IN ('open','admitted') AND NOT EXISTS(SELECT 1 FROM img.study WHERE order_id=r.id) AND NOT EXISTS(SELECT 1 FROM img.report WHERE order_id=r.id)) AS request,
    EXISTS(SELECT 1 FROM img.schedule_reservation b WHERE b.order_id=r.id) AS booking,
    EXISTS(SELECT 1 FROM img.schedule_reservation b JOIN img.booking_arrival a ON a.booking_id=b.booking_id WHERE b.order_id=r.id) AS arrival,
    EXISTS(SELECT 1 FROM img.schedule_reservation res JOIN img.schedule_booking b ON b.id=res.booking_id JOIN img.protocol_review v ON v.id=b.protocol_review_id JOIN img.protocol_template t ON t.id=v.template_id AND t.version=v.template_version JOIN img.facility_protocol fp ON fp.template_id=t.id WHERE res.order_id=r.id AND v.decision='approved' AND v.order_version=(SELECT max(latest.order_version) FROM img.protocol_review latest WHERE latest.order_id=r.id) AND t.procedure_id=r.procedure_id AND ${this.protocolAvailable(scope)}) AS protocol,
    EXISTS(SELECT 1 FROM img.schedule_reservation b JOIN img.schedule_slot s ON s.id=b.slot_id JOIN img.schedule_resource resource ON resource.id=s.resource_id WHERE b.order_id=r.id AND s.active AND resource.active AND NOT resource.blocked AND resource.facility_id=p.facility_id) AS resource
    ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)}`.execute(this.db)).rows[0];
    if(!facts)throw new NotFoundException('Imaging request unavailable.');
    const checks:import('@pulse/api-contracts').StaffImagingReadiness['checks']=[
      {id:'request',label:'Active unprocessed request',met:facts.request,detail:facts.request?'Patient and encounter remain active; processing has not been recorded.':'Review request, patient/encounter status and any existing study or report.'},
      {id:'booking',label:'Current appointment',met:facts.booking,detail:facts.booking?'An active appointment is recorded.':'Book or reconcile the imaging appointment.'},
      {id:'arrival',label:'Patient arrival verified',met:facts.arrival,detail:facts.arrival?'Two-identifier arrival evidence is recorded for this booking.':'Confirm the patient’s arrival and identifiers.'},
      {id:'protocol',label:'Booked planning approval is current',met:facts.protocol,detail:facts.protocol?'The booked review remains the latest approval under a current mapped template.':'Resolve protocol holds or reconcile a changed planning decision/template with the appointment.'},
      {id:'resource',label:'Resource available',met:facts.resource,detail:facts.resource?'The configured resource and slot remain active and unblocked.':'Review resource availability or reschedule the appointment.'},
    ];
    await this.audit(scope,id,'imaging.readiness_read','imaging_order');return {checks,prerequisitesSatisfied:checks.every(c=>c.met),checkedAt:new Date().toISOString()};
  }
  async arrive(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingArrivalInput){
    this.schedulePrivilege(scope,'imaging:arrival');
    if(input.attestation!==true||!Array.isArray(input.identifierMethods)||input.identifierMethods.length<2||input.identifierMethods.length>3||new Set(input.identifierMethods).size!==input.identifierMethods.length||input.identifierMethods.some(m=>!['full-name','date-of-birth','mrn'].includes(m))||typeof input.note!=='string'||input.note.length>1000)throw new BadRequestException('Verify two distinct patient identifiers and review the arrival.');
    await staffCommand(this.db,scope,input.commandKey,'imaging.arrived',{id,...input},async trx=>{
      const order=(await sql<{version:number;status:string;patient_status:string;encounter_status:string;mrn_present:boolean}>`SELECT r.version,r.status,p.status AS patient_status,e.status AS encounter_status,EXISTS(SELECT 1 FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.system='urn:pulse:mrn:'||p.facility_id::text) AS mrn_present ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)} FOR UPDATE OF r FOR SHARE OF p,e`.execute(trx)).rows[0];
      if(!order)throw new NotFoundException('Imaging request unavailable.');
      const booking=(await sql<{booking_id:string}>`SELECT booking_id FROM img.schedule_reservation WHERE order_id=${id}::uuid`.execute(trx)).rows[0];
      const processed=(await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(trx)).rows.length;
      if(order.version!==input.expectedVersion||order.status!=='scheduled'||order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status)||!booking||booking.booking_id!==input.bookingId||processed||(await sql`SELECT booking_id FROM img.booking_arrival WHERE booking_id=${input.bookingId}::uuid`.execute(trx)).rows.length)throw new ConflictException({code:'IMAGING_ATTENDANCE_CHANGED',message:'The appointment changed, arrival was recorded or processing started. Reload before continuing.'});
      if(input.identifierMethods.includes('mrn')&&!order.mrn_present)throw new BadRequestException('The record has no facility MRN to verify. Choose identifiers actually available.');
      await sql`INSERT INTO img.booking_arrival(booking_id,identifier_methods,note,arrived_by)VALUES(${input.bookingId}::uuid,${input.identifierMethods}::text[],${input.note.trim()},${scope.personId}::uuid)`.execute(trx);
      await sql`UPDATE img.img_order SET version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'imaging_order',id,'imaging.arrived',{bookingId:input.bookingId,version:order.version+1});
      return {bookingId:input.bookingId};
    });return this.dutyGet(scope,id);
  }
  async changeBooking(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingBookingChangeInput&{slotId?:string},kind:'cancelled'|'rescheduled'|'no-show'){
    this.schedulePrivilege(scope,kind==='rescheduled'?'imaging:reschedule':kind==='no-show'?'imaging:no-show':'imaging:appointment:cancel');
    if(input.attestation!==true||input.reason.trim().length<3||input.reason.trim().length>1000||(kind==='rescheduled'&&!input.slotId))throw new BadRequestException('Review the appointment change and record a reason.');
    const action=`imaging.appointment_${kind.replaceAll('-','_')}`;
    await staffCommand(this.db,scope,input.commandKey,action,{id,...input},async trx=>{
      const order=(await sql<{version:number;status:string;procedure_id:string|null;patient_status:string;encounter_status:string}>`SELECT r.version,r.status,r.procedure_id,p.status AS patient_status,e.status AS encounter_status ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)} FOR UPDATE OF r FOR SHARE OF p,e`.execute(trx)).rows[0];
      if(!order)throw new NotFoundException('Imaging request unavailable.');
      const booking=(await sql<{booking_id:string;slot_id:string;resource_id:string}>`SELECT b.booking_id,b.slot_id,s.resource_id FROM img.schedule_reservation b JOIN img.schedule_slot s ON s.id=b.slot_id WHERE b.order_id=${id}::uuid`.execute(trx)).rows[0];
      const processed=(await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(trx)).rows.length;
      if(order.version!==input.expectedVersion||order.status!=='scheduled'||!booking||booking.booking_id!==input.bookingId||processed)throw new ConflictException({code:'IMAGING_APPOINTMENT_CHANGED',message:'The appointment changed or processing started. Reload before continuing.'});
      if(kind==='no-show'&&!(await sql`SELECT b.booking_id FROM img.schedule_reservation b JOIN img.schedule_slot s ON s.id=b.slot_id WHERE b.booking_id=${booking.booking_id}::uuid AND s.ends_at<=now() AND NOT EXISTS(SELECT 1 FROM img.booking_arrival a WHERE a.booking_id=b.booking_id)`.execute(trx)).rows.length)throw new ConflictException({code:'IMAGING_NO_SHOW_UNAVAILABLE',message:'No-show requires an ended appointment without a recorded arrival.'});
      let approval:{id:string}|undefined;
      let targetResource:string|undefined;
      if(kind==='rescheduled'){
        if(order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status))throw new ConflictException('An active patient and encounter are required for rescheduling.');
        const latest=(await sql<{id:string;template_id:string;template_version:number;decision:string}>`SELECT id,template_id,template_version,decision FROM img.protocol_review WHERE order_id=${id}::uuid ORDER BY order_version DESC LIMIT 1`.execute(trx)).rows[0];
        if(!latest||latest.decision!=='approved')throw new ConflictException({code:'IMAGING_PROTOCOL_REQUIRED',message:'Resolve the protocol hold before rescheduling.'});
        if(!(await sql`${this.protocolSelect()} WHERE t.id=${latest.template_id}::uuid AND t.version=${latest.template_version} AND t.procedure_id=${order.procedure_id}::uuid AND ${this.protocolAvailable(scope)} FOR SHARE OF t,fp`.execute(trx)).rows.length)throw new ConflictException({code:'IMAGING_PROTOCOL_TEMPLATE_CHANGED',message:'Obtain a current protocol planning review before rescheduling.'});
        approval=latest;
        targetResource=(await sql<{resource_id:string}>`SELECT resource_id FROM img.schedule_slot WHERE id=${input.slotId!}::uuid`.execute(trx)).rows[0]?.resource_id;
        if(!targetResource||input.slotId===booking.slot_id)throw new ConflictException({code:'IMAGING_SLOT_UNAVAILABLE',message:'Choose a different available slot.'});
      }
      await sql`SELECT id FROM img.schedule_resource WHERE id IN (${booking.resource_id}::uuid,${targetResource??booking.resource_id}::uuid) ORDER BY id FOR UPDATE`.execute(trx);
      if(kind==='rescheduled'){
        const target=(await sql`SELECT s.id FROM img.schedule_slot s JOIN img.schedule_resource r ON r.id=s.resource_id WHERE s.id=${input.slotId!}::uuid AND r.facility_id=${scope.facilityId}::uuid AND r.active AND NOT r.blocked AND s.active AND s.procedure_id=${order.procedure_id}::uuid AND s.starts_at>now() AND NOT EXISTS(SELECT 1 FROM img.schedule_reservation b WHERE b.slot_id=s.id) FOR UPDATE OF s`.execute(trx)).rows.length;
        if(!target)throw new ConflictException({code:'IMAGING_SLOT_UNAVAILABLE',message:'The replacement slot is unavailable. Your original appointment has been retained.'});
      }
      await sql`INSERT INTO img.booking_release(booking_id,kind,reason,released_by)VALUES(${booking.booking_id}::uuid,${kind},${input.reason.trim()},${scope.personId}::uuid)`.execute(trx);
      let replacementId:string|null=null;
      if(kind==='rescheduled')replacementId=(await sql<{id:string}>`INSERT INTO img.schedule_booking(order_id,slot_id,protocol_review_id,order_version,reason,booked_by)VALUES(${id}::uuid,${input.slotId!}::uuid,${approval!.id}::uuid,${order.version},${input.reason.trim()},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!.id;
      await sql`UPDATE img.img_order SET status=${kind==='rescheduled'?'scheduled':'ordered'},version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'imaging_order',id,action,{bookingId:booking.booking_id,replacementId,version:order.version+1});
      return {bookingId:booking.booking_id,replacementId};
    });return this.dutyGet(scope,id);
  }
  async slots(scope:PatientReadScope,id:string,from:string,to:string){
    this.duty(scope);if(!['imaging:schedule','imaging:reschedule'].some(p=>scope.privileges.includes(p)))throw new ForbiddenException('Scheduling permission is required.');
    const start=Date.parse(from),end=Date.parse(to),iso=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
    if(!iso.test(from)||!iso.test(to)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>7*86400000)throw new BadRequestException('Choose a valid scheduling window of at most seven days with a time zone.');
    const order=(await sql<{procedure_id:string|null}>`SELECT r.procedure_id ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)}`.execute(this.db)).rows[0];
    if(!order)throw new NotFoundException('Imaging request unavailable.');
    const rows=(await sql<import('@pulse/api-contracts').StaffImagingSlot>`${this.slotSelect()} WHERE r.facility_id=${scope.facilityId}::uuid AND r.active AND NOT r.blocked AND s.active AND s.procedure_id=${order.procedure_id}::uuid AND s.starts_at>=${new Date(start).toISOString()}::timestamptz AND s.starts_at<${new Date(end).toISOString()}::timestamptz AND s.starts_at>now() AND NOT EXISTS(SELECT 1 FROM img.schedule_reservation b WHERE b.slot_id=s.id) ORDER BY s.starts_at,r.name,s.id LIMIT 101`.execute(this.db)).rows;
    await this.audit(scope,scope.facilityId,'imaging.slots_read','facility');return {items:rows.slice(0,100),hasMore:rows.length>100};
  }
  async schedule(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingScheduleInput){
    this.schedulePrivilege(scope);
    if(input.attestation!==true||input.reason.trim().length<3||input.reason.trim().length>1000)throw new BadRequestException('Review the booking and record a scheduling note.');
    await staffCommand(this.db,scope,input.commandKey,'imaging.scheduled',{id,...input},async trx=>{
      const order=(await sql<{version:number;status:string;procedure_id:string|null;patient_status:string;encounter_status:string}>`SELECT r.version,r.status,r.procedure_id,p.status AS patient_status,e.status AS encounter_status ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)} FOR UPDATE OF r FOR SHARE OF p,e`.execute(trx)).rows[0];
      if(!order)throw new NotFoundException('Imaging request unavailable.');
      const processed=(await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(trx)).rows.length;
      if(order.version!==input.expectedVersion||order.status!=='ordered'||order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status)||processed)throw new ConflictException({code:'IMAGING_SCHEDULE_CHANGED',message:'The request changed or processing started. Reload before booking.'});
      const approval=(await sql<{id:string;template_id:string;template_version:number;order_version:number;decision:string}>`SELECT id,template_id,template_version,order_version,decision FROM img.protocol_review WHERE order_id=${id}::uuid ORDER BY order_version DESC LIMIT 1`.execute(trx)).rows[0];
      if(!approval||approval.decision!=='approved'||approval.order_version>=order.version)throw new ConflictException({code:'IMAGING_PROTOCOL_REQUIRED',message:'A current approved protocol planning decision is required before booking.'});
      const currentTemplate=(await sql`${this.protocolSelect()} WHERE t.id=${approval.template_id}::uuid AND t.version=${approval.template_version} AND t.procedure_id=${order.procedure_id}::uuid AND ${this.protocolAvailable(scope)} FOR SHARE OF t,fp`.execute(trx)).rows.length;
      if(!currentTemplate)throw new ConflictException({code:'IMAGING_PROTOCOL_TEMPLATE_CHANGED',message:'The approved planning template is no longer current. Obtain a new protocol review.'});
      const resource=(await sql<{id:string}>`SELECT r.id FROM img.schedule_resource r JOIN img.schedule_slot s ON s.resource_id=r.id WHERE s.id=${input.slotId}::uuid AND r.facility_id=${scope.facilityId}::uuid FOR UPDATE OF r`.execute(trx)).rows[0];
      if(!resource)throw new ConflictException({code:'IMAGING_SLOT_UNAVAILABLE',message:'This slot is unavailable at the selected facility.'});
      const slot=(await sql<{id:string}>`SELECT s.id FROM img.schedule_slot s JOIN img.schedule_resource r ON r.id=s.resource_id WHERE s.id=${input.slotId}::uuid AND s.procedure_id=${order.procedure_id}::uuid AND r.active AND NOT r.blocked AND s.active AND s.starts_at>now() AND NOT EXISTS(SELECT 1 FROM img.schedule_reservation b WHERE b.slot_id=s.id) FOR UPDATE OF s`.execute(trx)).rows[0];
      if(!slot)throw new ConflictException({code:'IMAGING_SLOT_UNAVAILABLE',message:'This slot was booked, blocked or changed. Refresh availability.'});
      const booking=(await sql<{id:string}>`INSERT INTO img.schedule_booking(order_id,slot_id,protocol_review_id,order_version,reason,booked_by)VALUES(${id}::uuid,${slot.id}::uuid,${approval.id}::uuid,${order.version},${input.reason.trim()},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!;
      await sql`UPDATE img.img_order SET status='scheduled',version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'imaging_order',id,'imaging.scheduled',{bookingId:booking.id,slotId:slot.id,protocolReviewId:approval.id,version:order.version+1});
      return {id:booking.id};
    });return this.dutyGet(scope,id);
  }
  private duty(scope:PatientReadScope){
    if(!['patient:read','imaging:view','imaging:worklist'].every(p=>scope.privileges.includes(p)))throw new ForbiddenException({code:'ACCESS_DENIED',message:'Radiology duty access is required.'});
  }
  private dutyScope(scope:PatientReadScope){return sql`p.facility_id=${scope.facilityId}::uuid AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)`;}
  private dutyFrom(){return sql`FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id LEFT JOIN img.procedure t ON t.id=r.procedure_id AND t.version=r.procedure_version`;}
  private dutySelect(){return sql`SELECT r.id,(SELECT a.created_at::text FROM img.booking_arrival a JOIN img.schedule_reservation res ON res.booking_id=a.booking_id WHERE res.order_id=r.id) AS "arrivedAt",(SELECT s.starts_at::text FROM img.schedule_reservation b JOIN img.schedule_slot s ON s.id=b.slot_id WHERE b.order_id=r.id) AS "scheduledAt",(SELECT pr.decision FROM img.protocol_review pr WHERE pr.order_id=r.id ORDER BY pr.order_version DESC LIMIT 1) AS "protocolDecision",jsonb_build_object('givenName',p.given_name,'familyName',p.family_name,'dateOfBirth',p.date_of_birth::text,'mrn',(SELECT i.value FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.system='urn:pulse:mrn:'||p.facility_id::text ORDER BY i.created_at,i.id LIMIT 1)) AS patient,COALESCE(t.name,r.procedure_code) AS "procedureName",r.procedure_code AS "procedureCode",t.modality,r.body_region AS "bodyRegion",r.laterality,r.urgency,r.status,r.created_at::text AS "orderedAt",e.type AS "encounterType",e.status AS "encounterStatus",r.procedure_version AS "catalogueVersion"`;}
  async queue(scope:PatientReadScope,status:string,query:string,cursor?:string):Promise<import('@pulse/api-contracts').StaffImagingQueuePage>{
    this.duty(scope);const states=['ordered','scheduled','protocolled','acquired','reported'];const q=query.trim();
    if(!['all',...states].includes(status)||q.length>100||(q.length>0&&q.length<2)||(cursor&&cursor.length>400))throw new BadRequestException('Choose valid radiology filters.');
    let position:{rank:number;at:string;id:string}|undefined;
    if(cursor){try{position=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!position||![0,1,2].includes(position.rank)||typeof position.at!=='string'||!/^\d{4}-\d\d-\d\d[ T]/.test(position.at)||!Number.isFinite(Date.parse(position.at))||typeof position.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(position.id))throw new Error();}catch{throw new BadRequestException('Invalid radiology page.');}}
    const rank=sql`CASE r.urgency WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END`,pattern=q.replace(/[\\%_]/g,'\\$&')+'%';
    const filter=sql`${this.dutyScope(scope)} AND r.status IN ('ordered','scheduled','protocolled','acquired','reported') AND (${q===''} OR p.given_name ILIKE ${pattern} OR p.family_name ILIKE ${pattern} OR COALESCE(t.name,r.procedure_code) ILIKE ${pattern} OR EXISTS(SELECT 1 FROM patient.identifier i WHERE i.patient_id=p.id AND i.facility_id=p.facility_id AND i.value=${q}))`;
    const result=await this.db.transaction().setIsolationLevel('repeatable read').execute(async trx=>{
      const counts=(await sql<{counts:import('@pulse/api-contracts').StaffImagingQueuePage['counts']}>`SELECT jsonb_build_object('ordered',count(*) FILTER(WHERE r.status='ordered'),'scheduled',count(*) FILTER(WHERE r.status='scheduled'),'protocolled',count(*) FILTER(WHERE r.status='protocolled'),'acquired',count(*) FILTER(WHERE r.status='acquired'),'reported',count(*) FILTER(WHERE r.status='reported')) AS counts ${this.dutyFrom()} WHERE ${filter}`.execute(trx)).rows[0]!.counts;
      const rows=(await sql<import('@pulse/api-contracts').StaffImagingDutyRequest&{priority_rank:number}>`${this.dutySelect()},${rank} AS priority_rank ${this.dutyFrom()} WHERE ${filter} ${status==='all'?sql``:sql`AND r.status=${status}`} ${position?sql`AND (${rank},r.created_at,r.id)>(${position.rank},${position.at}::timestamptz,${position.id}::uuid)`:sql``} ORDER BY ${rank},r.created_at,r.id LIMIT 26`.execute(trx)).rows;
      const last=rows[24];return {items:rows.slice(0,25).map(({priority_rank,...row})=>{void priority_rank;return row;}),counts,nextCursor:rows.length>25&&last?Buffer.from(JSON.stringify({rank:last.priority_rank,at:last.orderedAt,id:last.id})).toString('base64url'):null,fetchedAt:new Date().toISOString()};
    });await this.audit(scope,scope.facilityId,'imaging.queue_read','facility');return result;
  }
  async dutyGet(scope:PatientReadScope,id:string):Promise<import('@pulse/api-contracts').StaffImagingDutyDetail>{
    this.duty(scope);const row=(await sql<import('@pulse/api-contracts').StaffImagingDutyDetail>`${this.dutySelect()},r.indication,r.safety_context AS "safetyContext",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.ordered_by ORDER BY c.created_at DESC LIMIT 1) AS "orderedByLabel" ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)}`.execute(this.db)).rows[0];
    if(!row)throw new NotFoundException({code:'IMAGING_ORDER_NOT_FOUND',message:'This request is unavailable at the selected facility.'});
    row.bookingHistory=(await sql<import('@pulse/api-contracts').StaffImagingBooking>`SELECT s.id,s.starts_at::text AS "startsAt",s.ends_at::text AS "endsAt",r.id AS "resourceId",r.name AS "resourceName",r.location,r.modality,b.id AS "bookingId",b.protocol_review_id AS "protocolReviewId",b.reason,b.created_at::text AS "bookedAt",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=b.booked_by ORDER BY c.created_at DESC LIMIT 1) AS "bookedByLabel",CASE WHEN ar.booking_id IS NULL THEN NULL ELSE jsonb_build_object('identifierMethods',ar.identifier_methods,'note',ar.note,'arrivedAt',ar.created_at,'arrivedByLabel',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=ar.arrived_by ORDER BY c.created_at DESC LIMIT 1)) END AS arrival,CASE WHEN rel.booking_id IS NULL THEN NULL ELSE jsonb_build_object('kind',rel.kind,'reason',rel.reason,'releasedAt',rel.created_at,'releasedByLabel',(SELECT c.login_id FROM iam.credential c WHERE c.person_id=rel.released_by ORDER BY c.created_at DESC LIMIT 1)) END AS release FROM img.schedule_booking b JOIN img.schedule_slot s ON s.id=b.slot_id JOIN img.schedule_resource r ON r.id=s.resource_id LEFT JOIN img.booking_release rel ON rel.booking_id=b.id LEFT JOIN img.booking_arrival ar ON ar.booking_id=b.id WHERE b.order_id=${id}::uuid AND r.facility_id=${scope.facilityId}::uuid ORDER BY b.order_version DESC,b.id DESC LIMIT 100`.execute(this.db)).rows;
    row.booking=row.bookingHistory.find(b=>!b.release)??null;
    row.version=(await sql<{version:number}>`SELECT version FROM img.img_order WHERE id=${id}::uuid`.execute(this.db)).rows[0]!.version;
    row.protocolReviews=(await sql<import('@pulse/api-contracts').StaffImagingProtocolReview>`SELECT v.id,v.order_version AS "orderVersion",v.decision,v.responses,v.reason,v.created_at::text AS "reviewedAt",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=v.reviewed_by ORDER BY c.created_at DESC LIMIT 1) AS "reviewedByLabel",jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'version',t.version,'instructions',t.instructions,'policyReference',t.policy_reference,'checks',t.checks) AS template FROM img.protocol_review v JOIN img.protocol_template t ON t.id=v.template_id AND t.version=v.template_version WHERE v.order_id=${id}::uuid ORDER BY v.order_version DESC,v.id DESC LIMIT 100`.execute(this.db)).rows;
    await this.audit(scope,id,'imaging.duty_order_read','imaging_order');return row;
  }
  private protocolPrivilege(scope:PatientReadScope){this.duty(scope);if(!scope.privileges.includes('imaging:protocol'))throw new ForbiddenException({code:'ACCESS_DENIED',message:'Protocol review permission is required.'});}
  private protocolAvailable(scope:PatientReadScope){return sql`t.active AND fp.active AND fp.facility_id=${scope.facilityId}::uuid AND NOT EXISTS(SELECT 1 FROM img.protocol_template n JOIN img.facility_protocol nf ON nf.template_id=n.id AND nf.facility_id=fp.facility_id AND nf.active WHERE n.code=t.code AND n.version>t.version AND n.active)`;}
  private protocolSelect(){return sql`SELECT t.id,t.code,t.name,t.version,t.instructions,t.policy_reference AS "policyReference",t.checks FROM img.protocol_template t JOIN img.facility_protocol fp ON fp.template_id=t.id`;}
  async protocols(scope:PatientReadScope,id:string){
    this.protocolPrivilege(scope);
    const order=(await sql<{procedure_id:string|null}>`SELECT r.procedure_id ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)}`.execute(this.db)).rows[0];
    if(!order)throw new NotFoundException('Imaging request unavailable.');
    return (await sql<import('@pulse/api-contracts').StaffImagingProtocolTemplate>`${this.protocolSelect()} WHERE t.procedure_id=${order.procedure_id}::uuid AND ${this.protocolAvailable(scope)} ORDER BY t.name,t.id LIMIT 100`.execute(this.db)).rows;
  }
  async reviewProtocol(scope:PatientReadScope,id:string,input:import('@pulse/api-contracts').StaffImagingProtocolInput){
    this.protocolPrivilege(scope);
    if(input.attestation!==true||input.reason.trim().length<3||input.reason.trim().length>2000)throw new BadRequestException('Review the request and document the decision.');
    await staffCommand(this.db,scope,input.commandKey,'imaging.protocol_reviewed',{id,...input},async trx=>{
      const order=(await sql<{version:number;status:string;procedure_id:string|null;patient_status:string;encounter_status:string}>`SELECT r.version,r.status,r.procedure_id,p.status AS patient_status,e.status AS encounter_status ${this.dutyFrom()} WHERE r.id=${id}::uuid AND ${this.dutyScope(scope)} FOR UPDATE OF r FOR SHARE OF p,e`.execute(trx)).rows[0];
      if(!order)throw new NotFoundException('Imaging request unavailable.');
      const processed=(await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid LIMIT 1`.execute(trx)).rows.length;
      if(order.version!==input.expectedVersion||!['ordered','scheduled'].includes(order.status)||order.patient_status!=='active'||!['open','admitted'].includes(order.encounter_status)||processed)throw new ConflictException({code:'IMAGING_PROTOCOL_REVIEW_CHANGED',message:'The request changed or processing started. Reload before recording a protocol decision.'});
      const template=(await sql<import('@pulse/api-contracts').StaffImagingProtocolTemplate>`${this.protocolSelect()} WHERE t.id=${input.templateId}::uuid AND t.version=${input.templateVersion} AND t.procedure_id=${order.procedure_id}::uuid AND ${this.protocolAvailable(scope)} FOR SHARE OF t,fp`.execute(trx)).rows[0];
      if(!template)throw new ConflictException({code:'IMAGING_PROTOCOL_TEMPLATE_CHANGED',message:'The selected protocol template is no longer available. Review the current templates.'});
      const checks=template.checks;
      if(!Array.isArray(checks)||!checks.length||checks.length>30||checks.some(c=>!c||!/^[-a-zA-Z0-9_]{1,60}$/.test(c.key)||typeof c.label!=='string'||!c.label.trim()||typeof c.allowNotApplicable!=='boolean')||new Set(checks.map(c=>c.key)).size!==checks.length)throw new ConflictException('This protocol template needs configuration review.');
      if(!input.responses||Array.isArray(input.responses)||Object.keys(input.responses).length!==checks.length)throw new BadRequestException('Answer every configured screening item.');
      for(const check of checks){
        const response=Object.hasOwn(input.responses,check.key)?input.responses[check.key]:undefined;
        if(!response||Object.keys(response).some(k=>!['outcome','note'].includes(k))||!['clear','concern','unknown','not-applicable'].includes(response.outcome)||typeof response.note!=='string'||response.note.length>1000||(response.outcome==='not-applicable'&&!check.allowNotApplicable)||(['concern','unknown','not-applicable'].includes(response.outcome)&&response.note.trim().length<3))throw new BadRequestException('Record a valid outcome and explanation for each screening item.');
        if(input.decision==='approved'&&!['clear','not-applicable'].includes(response.outcome))throw new ConflictException({code:'IMAGING_SCREENING_UNRESOLVED',message:'Unresolved screening items require a hold decision.'});
      }
      const review=(await sql<{id:string}>`INSERT INTO img.protocol_review(order_id,template_id,template_version,order_version,decision,responses,reason,reviewed_by)VALUES(${id}::uuid,${template.id}::uuid,${template.version},${order.version},${input.decision},${JSON.stringify(input.responses)}::jsonb,${input.reason.trim()},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!;
      await sql`UPDATE img.img_order SET version=version+1 WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'imaging_order',id,'imaging.protocol_reviewed',{reviewId:review.id,templateId:template.id,templateVersion:template.version,decision:input.decision,version:order.version+1});
      return {id:review.id};
    });
    return this.dutyGet(scope,id);
  }
  private require(
    scope: PatientReadScope,
    action?: 'imaging:order' | 'imaging:cancel',
  ) {
    if (
      !scope.privileges.includes('imaging:view') ||
      (action &&
        (!scope.privileges.includes(action) ||
          !scope.privileges.includes('encounter:consult')))
    )
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'This imaging action is unavailable for your account.',
      });
  }
  private patient(scope: PatientReadScope, patientId: string) {
    return sql`p.id=${patientId}::uuid AND p.facility_id=${scope.facilityId}::uuid
    AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)
    AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=p.facility_id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))`;
  }
  private eligible(scope: PatientReadScope, patientId: string) {
    return sql`${this.patient(scope, patientId)} AND p.status='active' AND e.status IN ('open','admitted')
    AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=p.facility_id AND a.encounter_id=e.id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))
    AND (e.type IN ('inpatient','emergency') OR (e.type='outpatient' AND EXISTS(SELECT 1 FROM encounter.outpatient_visit v WHERE v.encounter_id=e.id AND v.patient_id=p.id AND v.facility_id=p.facility_id AND v.stage='in-consultation' AND v.clinician_person_id=${scope.personId}::uuid)))`;
  }
  async contexts(scope: PatientReadScope, patientId: string) {
    this.require(scope, 'imaging:order');
    const rows = (
      await sql<{
        id: string;
        type: string;
        started_at: Date;
      }>`SELECT e.id,e.type,e.started_at FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE ${this.eligible(scope, patientId)} ORDER BY e.started_at DESC,e.id DESC LIMIT 100`.execute(
        this.db,
      )
    ).rows;
    return rows.map((r) => ({
      encounterId: r.id,
      type: r.type,
      startedAt: r.started_at.toISOString(),
    }));
  }
  private async context(
    trx: Transaction<PulseDatabase>,
    scope: PatientReadScope,
    patientId: string,
    encounterId: string,
  ) {
    await sql`SELECT id FROM iam.care_assignment WHERE person_id=${scope.personId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND encounter_id=${encounterId}::uuid FOR SHARE`.execute(
      trx,
    );
    await sql`SELECT encounter_id FROM encounter.outpatient_visit WHERE encounter_id=${encounterId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid FOR SHARE`.execute(
      trx,
    );
    const rows =
      await sql`SELECT e.id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE e.id=${encounterId}::uuid AND ${this.eligible(scope, patientId)} FOR SHARE OF e,p`.execute(
        trx,
      );
    if (!rows.rows.length)
      throw new ForbiddenException({
        code: 'IMAGING_ENCOUNTER_NOT_ASSIGNED',
        message:
          'An active encounter assigned to the treating clinician is required.',
      });
  }
  private available(scope: PatientReadScope) {
    return sql`t.active AND ft.active AND ft.facility_id=${scope.facilityId}::uuid AND NOT EXISTS(
    SELECT 1 FROM img.procedure newer JOIN img.facility_procedure nf ON nf.procedure_id=newer.id AND nf.facility_id=ft.facility_id AND nf.active WHERE newer.code=t.code AND newer.version>t.version AND newer.active)`;
  }
  async catalogue(scope: PatientReadScope, patientId: string, query: string) {
    this.require(scope, 'imaging:order');
    const q = query.trim();
    if (q.length > 100 || (q.length > 0 && q.length < 2))
      throw new BadRequestException('Use 2 to 100 search characters.');
    const patient =
      await sql`SELECT p.id FROM patient.patient p WHERE ${this.patient(scope, patientId)}`.execute(
        this.db,
      );
    if (!patient.rows.length)
      throw new NotFoundException(
        'This patient is unavailable in your care context.',
      );
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const items = (
      await sql<StaffImagingProcedure>`SELECT t.id,t.code,t.name,t.instructions,t.modality,t.body_region AS "bodyRegion",t.laterality_policy AS "lateralityPolicy",t.version FROM img.procedure t JOIN img.facility_procedure ft ON ft.procedure_id=t.id WHERE ${this.available(scope)} AND (t.name ILIKE ${pattern} OR t.code ILIKE ${pattern}) ORDER BY lower(t.name),t.code,t.id LIMIT 26`.execute(
        this.db,
      )
    ).rows;
    await this.audit(scope, patientId, 'imaging.catalogue_read');
    return { items: items.slice(0, 25), hasMore: items.length > 25 };
  }
  private async audit(
    scope: PatientReadScope,
    id: string,
    action: string,
    resourceType = 'patient',
  ) {
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff',${action},${resourceType},${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(
      this.db,
    );
  }
  async get(
    scope: PatientReadScope,
    patientId: string,
    id: string,
  ): Promise<StaffImagingOrder> {
    this.require(scope);
    const row = (
      await sql<StaffImagingOrder>`SELECT jsonb_build_object('type',e.type,'startedAt',e.started_at) AS encounter,r.id,r.patient_id AS "patientId",r.encounter_id AS "encounterId",CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'version',r.procedure_version,'instructions',t.instructions,'modality',t.modality,'bodyRegion',t.body_region,'lateralityPolicy',t.laterality_policy) ELSE NULL END AS procedure,r.procedure_code AS "procedureCode",r.body_region AS "bodyRegion",r.laterality,r.safety_context AS "safetyContext",EXISTS(SELECT 1 FROM img.protocol_review pr WHERE pr.order_id=r.id) AS "protocolReviewStarted",
      r.urgency,r.indication,r.status,r.version,r.ordered_by AS "orderedBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.ordered_by ORDER BY c.created_at DESC LIMIT 1) AS "orderedByLabel",r.created_at::text AS "orderedAt",r.cancel_reason AS "cancelReason",r.cancelled_by AS "cancelledBy",(SELECT c.login_id FROM iam.credential c WHERE c.person_id=r.cancelled_by ORDER BY c.created_at DESC LIMIT 1) AS "cancelledByLabel",r.cancelled_at::text AS "cancelledAt"
      FROM img.img_order r LEFT JOIN img.procedure t ON t.id=r.procedure_id AND t.version=r.procedure_version JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id
      WHERE r.id=${id}::uuid AND ${this.patient(scope, patientId)}`.execute(
        this.db,
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: 'IMAGING_ORDER_NOT_FOUND',
        message: 'This order is unavailable in your current care context.',
      });
    await this.audit(scope, id, 'imaging.order_read', 'imaging_order');
    return row;
  }
  async order(
    scope: PatientReadScope,
    patientId: string,
    input: StaffImagingOrderInput,
  ) {
    this.require(scope, 'imaging:order');
    const indication = input.indication.trim();
    if (
      indication.length < 3 ||
      indication.length > 2000 ||
      input.attestation !== true ||
      input.safetyContext.length > 2000
    )
      throw new BadRequestException(
        'Review the request and enter a clinical indication.',
      );
    const result = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'imaging.ordered',
      { patientId, ...input },
      async (trx) => {
        await this.context(trx, scope, patientId, input.encounterId);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`imaging-order/${input.encounterId}`},0))`.execute(
          trx,
        );
        const procedure = (
          await sql<StaffImagingProcedure>`SELECT t.id,t.code,t.name,t.version,t.instructions,t.modality,t.body_region AS "bodyRegion",t.laterality_policy AS "lateralityPolicy" FROM img.procedure t JOIN img.facility_procedure ft ON ft.procedure_id=t.id WHERE t.id=${input.procedureId}::uuid AND t.version=${input.procedureVersion} AND ${this.available(scope)} FOR SHARE OF t,ft`.execute(
            trx,
          )
        ).rows[0];
        if (!procedure)
          throw new ConflictException({
            code: 'IMAGING_CATALOGUE_CHANGED',
            message:
              'The selected procedure or version is no longer available at this facility. Review the catalogue again.',
          });
        if (
          !['left', 'right', 'bilateral', 'na'].includes(input.laterality) ||
          (procedure.lateralityPolicy === 'required' &&
            input.laterality === 'na') ||
          (procedure.lateralityPolicy === 'na' && input.laterality !== 'na')
        )
          throw new BadRequestException({
            code: 'IMAGING_LATERALITY_REQUIRED',
            message: 'Select the side required by the approved procedure.',
          });
        const pending =
          await sql`SELECT r.id FROM img.img_order r WHERE r.patient_id=${patientId}::uuid AND r.encounter_id=${input.encounterId}::uuid AND r.procedure_code=${procedure.code} AND r.status IN ('ordered','scheduled','protocolled','acquired','reported') AND COALESCE(r.laterality,'na')=${input.laterality}`.execute(
            trx,
          );
        if (pending.rows.length)
          throw new ConflictException({
            code: 'IMAGING_ORDER_PENDING',
            message:
              'This encounter already has a pending order for this procedure. Review it before ordering again.',
          });
        const row = (
          await sql<{
            id: string;
          }>`INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region,laterality,urgency,indication,safety_context,ordered_by)VALUES(${patientId}::uuid,${input.encounterId}::uuid,${procedure.id}::uuid,${procedure.version},${procedure.code},${procedure.bodyRegion},${input.laterality},${input.urgency},${indication},${input.safetyContext.trim()},${scope.personId}::uuid)RETURNING id`.execute(
            trx,
          )
        ).rows[0]!;
        await commandEvidence(
          trx,
          scope,
          'imaging_order',
          row.id,
          'imaging.ordered',
          {
            patientId,
            encounterId: input.encounterId,
            procedureCode: procedure.code,
            procedureId: procedure.id,
            procedureVersion: procedure.version,
            version: 1,
          },
        );
        return { id: row.id };
      },
    );
    return this.get(scope, patientId, result.id);
  }
  async cancel(
    scope: PatientReadScope,
    patientId: string,
    id: string,
    input: StaffLabCancellation,
  ) {
    this.require(scope, 'imaging:cancel');
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 1000)
      throw new BadRequestException('Enter a cancellation reason.');
    const result = await staffCommand(
      this.db,
      scope,
      input.commandKey,
      'imaging.cancelled',
      { patientId, id, ...input },
      async (trx) => {
        const current = (
          await sql<{
            encounter_id: string;
            status: string;
            version: number;
          }>`SELECT r.encounter_id,r.status,r.version FROM img.img_order r JOIN patient.patient p ON p.id=r.patient_id JOIN encounter.encounter e ON e.id=r.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id WHERE r.id=${id}::uuid AND ${this.patient(scope, patientId)} FOR UPDATE OF r`.execute(
            trx,
          )
        ).rows[0];
        if (!current)
          throw new NotFoundException(
            'This order is unavailable in your current care context.',
          );
        await this.context(trx, scope, patientId, current.encounter_id);
        const processed =
          await sql`SELECT id FROM img.study WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.report WHERE order_id=${id}::uuid UNION ALL SELECT id FROM img.protocol_review WHERE order_id=${id}::uuid LIMIT 1`.execute(
            trx,
          );
        if (
          current.status !== 'ordered' ||
          current.version !== input.expectedVersion ||
          processed.rows.length
        )
          throw new ConflictException({
            code: 'IMAGING_CANCELLATION_UNAVAILABLE',
            message:
              'This order changed or imaging processing has started. Review its status and contact radiology.',
          });
        await sql`UPDATE img.img_order SET status='cancelled',version=version+1,cancel_reason=${reason},cancelled_by=${scope.personId}::uuid,cancelled_at=now() WHERE id=${id}::uuid`.execute(
          trx,
        );
        await commandEvidence(
          trx,
          scope,
          'imaging_order',
          id,
          'imaging.cancelled',
          {
            patientId,
            encounterId: current.encounter_id,
            status: 'cancelled',
            version: current.version + 1,
          },
        );
        return { id };
      },
    );
    return this.get(scope, patientId, result.id);
  }
}
