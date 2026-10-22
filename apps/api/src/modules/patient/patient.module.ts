import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientService } from './application/patient.service.js';
import { PATIENT_REPOSITORY } from './domain/patient.repository.js';
import { KyselyPatientRepository } from './infrastructure/kysely-patient.repository.js';
import { PatientController } from './interface/patient.controller.js';
import { StaffPatientReadController, StaffPatientReadGuard } from './interface/staff-patient-read.controller.js';
import { StaffPatientReadService } from './application/staff-patient-read.service.js';
import { STAFF_PATIENT_READ_REPOSITORY } from './domain/staff-patient-read.repository.js';
import { KyselyStaffPatientReadRepository } from './infrastructure/kysely-staff-patient-read.repository.js';
import { StaffRegistrationController } from './interface/staff-registration.controller.js';
import { STAFF_REGISTRATION_REPOSITORY } from './domain/staff-registration.repository.js';
import { KyselyStaffRegistrationRepository } from './infrastructure/kysely-staff-registration.repository.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [PatientController, StaffPatientReadController, StaffRegistrationController],
  providers: [
    PatientService,
    { provide:STAFF_REGISTRATION_REPOSITORY,useClass:KyselyStaffRegistrationRepository },
    StaffPatientReadService, StaffPatientReadGuard,
    { provide: STAFF_PATIENT_READ_REPOSITORY, useClass: KyselyStaffPatientReadRepository },
    { provide: PATIENT_REPOSITORY, useClass: KyselyPatientRepository },
  ],
  exports: [PatientService, PATIENT_REPOSITORY, StaffPatientReadService, StaffPatientReadGuard],
})
export class PatientModule {}
