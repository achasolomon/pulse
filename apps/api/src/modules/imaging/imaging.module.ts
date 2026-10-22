import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { ImagingService } from './application/imaging.service.js';
import { IMAGING_REPOSITORY } from './domain/imaging.repository.js';
import { KyselyImagingRepository } from './infrastructure/kysely-imaging.repository.js';
import { ImagingController } from './interface/imaging.controller.js';
import {PatientModule} from '../patient/patient.module.js';
import {StaffImagingController} from './interface/staff-imaging.controller.js';
import {STAFF_IMAGING_REPOSITORY} from './domain/staff-imaging.repository.js';
import {KyselyStaffImagingRepository} from './infrastructure/kysely-staff-imaging.repository.js';

@Module({
  imports: [OutboxModule, IamModule,PatientModule],
  controllers: [ImagingController,StaffImagingController],
  providers: [
    {provide:STAFF_IMAGING_REPOSITORY,useClass:KyselyStaffImagingRepository},
    ImagingService,
    { provide: IMAGING_REPOSITORY, useClass: KyselyImagingRepository },
  ],
  exports: [ImagingService, IMAGING_REPOSITORY],
})
export class ImagingModule {}
