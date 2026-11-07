import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { ImagingService } from './application/imaging.service.js';
import { IMAGING_REPOSITORY } from './domain/imaging.repository.js';
import { KyselyImagingRepository } from './infrastructure/kysely-imaging.repository.js';
import { ImagingController } from './interface/imaging.controller.js';
import {PatientModule} from '../patient/patient.module.js';
import {StaffImagingController} from './interface/staff-imaging.controller.js';
import {StaffRadiologyController} from './interface/staff-radiology.controller.js';
import {STAFF_IMAGING_REPOSITORY} from './domain/staff-imaging.repository.js';
import {KyselyStaffImagingRepository} from './infrastructure/kysely-staff-imaging.repository.js';
import {PACS_GATEWAY} from './domain/pacs.gateway.js';
import {OrthancGateway} from './infrastructure/orthanc.gateway.js';
import {PacsConnectionService} from './application/pacs-connection.service.js';
import {StaffAcquisitionService} from './application/staff-acquisition.service.js';
import {StaffReportingService} from './application/staff-reporting.service.js';
import {ImagingHandoffService} from './application/imaging-handoff.service.js';
import {ImagingHandoffController} from './interface/imaging-handoff.controller.js';

@Module({
  imports: [OutboxModule, IamModule,PatientModule],
  controllers: [ImagingController,StaffImagingController,StaffRadiologyController,ImagingHandoffController],
  providers: [
    PacsConnectionService,
    StaffAcquisitionService,
    StaffReportingService,
    ImagingHandoffService,
    {provide:PACS_GATEWAY,useFactory:()=>new OrthancGateway({baseUrl:process.env.PULSE_ORTHANC_BASE_URL,username:process.env.PULSE_ORTHANC_USERNAME,password:process.env.PULSE_ORTHANC_PASSWORD,production:process.env.NODE_ENV==='production'})},
    {provide:STAFF_IMAGING_REPOSITORY,useClass:KyselyStaffImagingRepository},
    ImagingService,
    { provide: IMAGING_REPOSITORY, useClass: KyselyImagingRepository },
  ],
  exports: [ImagingService, IMAGING_REPOSITORY],
})
export class ImagingModule {}
