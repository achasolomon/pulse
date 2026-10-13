import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { LaboratoryService } from './application/laboratory.service.js';
import { LAB_REPOSITORY } from './domain/lab.repository.js';
import { KyselyLabRepository } from './infrastructure/kysely-lab.repository.js';
import { LaboratoryController } from './interface/laboratory.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [LaboratoryController],
  providers: [
    LaboratoryService,
    { provide: LAB_REPOSITORY, useClass: KyselyLabRepository },
  ],
  exports: [LaboratoryService, LAB_REPOSITORY],
})
export class LaboratoryModule {}
