import {ForbiddenException,Inject,Injectable} from '@nestjs/common';
import {sql,type Kysely} from 'kysely';
import {PACS_GATEWAY,type PacsGateway} from '../domain/pacs.gateway.js';
import {PULSE_DB} from '../../../platform/database/database.module.js';
import type {PulseDatabase} from '../../../platform/database/db.types.js';
import type {PatientReadScope} from '../../patient/domain/staff-patient-read.repository.js';
@Injectable()
export class PacsConnectionService {
 constructor(@Inject(PACS_GATEWAY) private readonly pacs:PacsGateway,@Inject(PULSE_DB) private readonly db:Kysely<PulseDatabase>){}
 async status(scope:PatientReadScope){
  if(!['patient:read','imaging:view','imaging:worklist'].every(p=>scope.privileges.includes(p)))throw new ForbiddenException('Radiology duty access is required.');
  const status=await this.pacs.status();
  await sql`INSERT INTO audit.audit_event(actor_id,actor_type,action,resource_type,resource_id,tenant_id,facility_id)VALUES(${scope.personId}::uuid,'staff','imaging.pacs_status_read','facility',${scope.facilityId}::uuid,${scope.organizationId}::uuid,${scope.facilityId}::uuid)`.execute(this.db);
  return status;
 }
}
