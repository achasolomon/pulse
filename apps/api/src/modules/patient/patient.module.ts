import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientService } from './application/patient.service.js';
import { PATIENT_REPOSITORY } from './domain/patient.repository.js';
import { KyselyPatientRepository } from './infrastructure/kysely-patient.repository.js';
import { PatientController } from './interface/patient.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [PatientController],
  providers: [
    PatientService,
    { provide: PATIENT_REPOSITORY, useClass: KyselyPatientRepository },
  ],
  exports: [PatientService, PATIENT_REPOSITORY],
})
export class PatientModule {}
