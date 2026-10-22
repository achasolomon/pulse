import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffContextService } from '../../iam/application/staff-context.service.js';
import {
  CARE_ASSIGNMENT_REPOSITORY,
  type CareAssignmentRepository,
} from '../../iam/domain/care-assignment.repository.js';
import {
  STAFF_PATIENT_READ_REPOSITORY,
  type PatientReadScope,
  type StaffPatientReadRepository,
} from '../domain/staff-patient-read.repository.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class StaffPatientReadService {
  constructor(
    private readonly staff: StaffContextService,
    @Inject(STAFF_PATIENT_READ_REPOSITORY)
    private readonly repo: StaffPatientReadRepository,
    @Inject(CARE_ASSIGNMENT_REPOSITORY)
    private readonly care: CareAssignmentRepository,
  ) {}
  async scope(
    authorization?: string,
    facilityId?: string,
    organizationId?: string,
  ) {
    const actor = await this.staff.self(authorization);
    const membership = actor.facilities.find(
      (f) => f.facilityId === facilityId && f.organizationId === organizationId,
    );
    if (!membership || !membership.privileges.includes('patient:read'))
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'You cannot view patients in this facility',
      });
    return {
      personId: actor.personId,
      organizationId: membership.organizationId,
      facilityId: membership.facilityId,
      privileges: membership.privileges,
    };
  }
  list(
    scope: PatientReadScope,
    query = '',
    status = 'active',
    cursor?: string,
  ) {
    const q = query.trim();
    if (
      q.length > 100 ||
      (q.length > 0 && q.length < 2) ||
      !['active', 'retired-duplicate', 'all'].includes(status) ||
      (cursor && !UUID.test(cursor))
    ) {
      throw new BadRequestException({
        code: 'PATIENT_SEARCH_INVALID',
        message: 'Use at least two search characters and valid patient filters',
      });
    }
    return this.repo.list(scope, q, status, cursor);
  }
  async identity(scope: PatientReadScope, id: string) {
    if (
      !scope.privileges.includes('care:unrestricted') &&
      !(await this.care.findActive({
        personId: scope.personId,
        facilityId: scope.facilityId,
        patientId: id,
      }))
    ) {
      throw new ForbiddenException({
        code: 'CARE_ACCESS_REQUIRED',
        message:
          'An active care assignment is required to open this patient record',
      });
    }
    const patient = await this.repo.identity(scope, id);
    if (!patient)
      throw new NotFoundException({
        code: 'PATIENT_NOT_FOUND',
        message: 'Patient is unavailable in this facility',
      });
    return patient;
  }
}
