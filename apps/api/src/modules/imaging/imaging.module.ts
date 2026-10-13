import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { ImagingService } from './application/imaging.service.js';
import { IMAGING_REPOSITORY } from './domain/imaging.repository.js';
import { KyselyImagingRepository } from './infrastructure/kysely-imaging.repository.js';
import { ImagingController } from './interface/imaging.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [ImagingController],
  providers: [
    ImagingService,
    { provide: IMAGING_REPOSITORY, useClass: KyselyImagingRepository },
  ],
  exports: [ImagingService, IMAGING_REPOSITORY],
})
export class ImagingModule {}
