import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {StaffProblemEntry,StaffProblemInput,StaffProblemResolution} from '@pulse/api-contracts';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import {staffCommand,commandEvidence} from '../../../platform/database/staff-command.js';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
import type {StaffEntryRepository} from '../domain/staff-entry.repository.js';
@Injectable()
export class KyselyStaffEntryRepository implements StaffEntryRepository {
  constructor(@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>) {}
  private require(scope:PatientReadScope,write=false) {
    if(!scope.privileges.includes('entry:read') || (write && (!scope.privileges.includes('entry:write')||!scope.privileges.includes('encounter:consult'))))
      throw new ForbiddenException({code:'ACCESS_DENIED',message:'Your account cannot perform this problem-list action.'});
  }
  private eligible(scope:PatientReadScope,patientId:string) {
    return sql`e.patient_id=${patientId}::uuid AND e.facility_id=${scope.facilityId}::uuid AND p.status='active' AND e.status IN ('open','admitted')
      AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=e.facility_id AND f.organization_id=${scope.organizationId}::uuid)
      AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=e.facility_id AND a.encounter_id=e.id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))
      AND ((e.type='outpatient' AND EXISTS(SELECT 1 FROM encounter.outpatient_visit v WHERE v.encounter_id=e.id AND v.patient_id=p.id AND v.facility_id=e.facility_id AND v.stage='in-consultation' AND v.clinician_person_id=${scope.personId}::uuid)) OR e.type IN ('inpatient','emergency'))`;
  }
  async contexts(scope:PatientReadScope,patientId:string) {
    this.require(scope,true);
    const rows=await sql<{id:string;type:string;started_at:Date}>`SELECT e.id,e.type,e.started_at FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE ${this.eligible(scope,patientId)} ORDER BY e.started_at DESC,e.id DESC LIMIT 100`.execute(this.db);
    return rows.rows.map(r=>({encounterId:r.id,type:r.type,startedAt:r.started_at.toISOString()}));
  }
  private async context(trx:Transaction<PulseDatabase>,scope:PatientReadScope,patientId:string,encounterId:string) {
    // Lock ownership and care before the eligibility check, keeping them stable through commit.
    await sql`SELECT id FROM iam.care_assignment WHERE person_id=${scope.personId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid AND encounter_id=${encounterId}::uuid FOR SHARE`.execute(trx);
    await sql`SELECT encounter_id FROM encounter.outpatient_visit WHERE encounter_id=${encounterId}::uuid AND patient_id=${patientId}::uuid AND facility_id=${scope.facilityId}::uuid FOR SHARE`.execute(trx);
    const row=await sql`SELECT e.id FROM encounter.encounter e JOIN patient.patient p ON p.id=e.patient_id AND p.facility_id=e.facility_id WHERE e.id=${encounterId}::uuid AND ${this.eligible(scope,patientId)} FOR SHARE OF e,p`.execute(trx);
    if(!row.rows.length)throw new ForbiddenException({code:'PROBLEM_ENCOUNTER_NOT_ASSIGNED',message:'Start your assigned consultation before changing the problem list.'});
  }
  async get(scope:PatientReadScope,patientId:string,id:string):Promise<StaffProblemEntry> {
    this.require(scope);
    const row=(await sql<StaffProblemEntry>`SELECT n.id,n.patient_id AS "patientId",n.encounter_id AS "encounterId",n.kind,n.display,n.code,n.origin,n.status,n.verification_status AS "verificationStatus",n.version,n.recorded_at::text AS "recordedAt",n.recorded_by::text AS "recordedBy",n.resolved_at::text AS "resolvedAt",n.resolved_by::text AS "resolvedBy",n.resolution_reason AS "resolutionReason",n.resolution_encounter_id AS "resolutionEncounterId"
      FROM clin.entry n JOIN patient.patient p ON p.id=n.patient_id WHERE n.id=${id}::uuid AND p.id=${patientId}::uuid AND p.facility_id=${scope.facilityId}::uuid AND n.kind IN ('problem','diagnosis')
      AND EXISTS(SELECT 1 FROM org.facility f WHERE f.id=p.facility_id AND f.organization_id=${scope.organizationId}::uuid)
      AND (n.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=n.encounter_id AND e.patient_id=p.id AND e.facility_id=p.facility_id))
      AND EXISTS(SELECT 1 FROM iam.care_assignment a WHERE a.person_id=${scope.personId}::uuid AND a.patient_id=p.id AND a.facility_id=p.facility_id AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()))`.execute(this.db)).rows[0];
    if(!row)throw new NotFoundException({code:'PROBLEM_NOT_FOUND',message:'This problem record is unavailable in your current care context.'});
    await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','entry.read','entry',${id}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);
    return row;
  }
  async create(scope:PatientReadScope,patientId:string,input:StaffProblemInput) {
    this.require(scope,true);
    const display=input.display.trim();
    if(display.length<3||display.length>300)throw new BadRequestException('Enter a problem or diagnosis between 3 and 300 characters.');
    const result=await staffCommand(this.db,scope,input.commandKey,'entry.recorded',{patientId,...input},async trx=>{
      await this.context(trx,scope,patientId,input.encounterId);
      // Serialise competing additions to this patient's list without collapsing genuinely different diagnoses.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`problems/${patientId}`},0))`.execute(trx);
      const duplicate=await sql`SELECT id FROM clin.entry WHERE patient_id=${patientId}::uuid AND kind=${input.kind} AND status='active' AND lower(btrim(display))=lower(${display})`.execute(trx);
      if(duplicate.rows.length)throw new ConflictException({code:'PROBLEM_ALREADY_ACTIVE',message:'An active entry with this description already exists. Review the problem list before adding another.'});
      const row=(await sql<{id:string}>`INSERT INTO clin.entry(patient_id,encounter_id,kind,display,verification_status,recorded_by)VALUES(${patientId}::uuid,${input.encounterId}::uuid,${input.kind},${display},${input.verificationStatus},${scope.personId}::uuid)RETURNING id`.execute(trx)).rows[0]!;
      await commandEvidence(trx,scope,'entry',row.id,'entry.recorded',{patientId,encounterId:input.encounterId,kind:input.kind,version:1});
      return {id:row.id};
    });
    return this.get(scope,patientId,result.id);
  }
  async resolve(scope:PatientReadScope,patientId:string,id:string,input:StaffProblemResolution) {
    this.require(scope,true);
    const reason=input.reason.trim();
    if(reason.length<3||reason.length>2000)throw new BadRequestException('Enter a resolution reason between 3 and 2000 characters.');
    const result=await staffCommand(this.db,scope,input.commandKey,'entry.resolved',{patientId,id,...input},async trx=>{
      await this.context(trx,scope,patientId,input.encounterId);
      const row=(await sql<{status:string;version:number}>`SELECT n.status,n.version FROM clin.entry n WHERE n.id=${id}::uuid AND n.patient_id=${patientId}::uuid AND n.kind IN ('problem','diagnosis') AND n.origin='local'
        AND (n.encounter_id IS NULL OR EXISTS(SELECT 1 FROM encounter.encounter e WHERE e.id=n.encounter_id AND e.patient_id=n.patient_id AND e.facility_id=${scope.facilityId}::uuid)) FOR UPDATE OF n`.execute(trx)).rows[0];
      if(!row)throw new NotFoundException('Only a local problem or diagnosis can be resolved here.');
      if(row.status!=='active'||row.version!==input.expectedVersion)throw new ConflictException({code:'PROBLEM_VERSION_CONFLICT',message:'This entry has changed. Your reason has been kept; close and review the latest record.'});
      await sql`UPDATE clin.entry SET status='resolved',version=version+1,resolved_by=${scope.personId}::uuid,resolved_at=now(),resolution_reason=${reason},resolution_encounter_id=${input.encounterId}::uuid WHERE id=${id}::uuid`.execute(trx);
      await commandEvidence(trx,scope,'entry',id,'entry.resolved',{patientId,encounterId:input.encounterId,version:row.version+1});
      return {id};
    });
    return this.get(scope,patientId,result.id);
  }
}
