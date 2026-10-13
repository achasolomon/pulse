import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { AnatomyService } from './application/anatomy.service.js';
import { ANATOMY_REPOSITORY } from './domain/anatomy.repository.js';
import { KyselyAnatomyRepository } from './infrastructure/kysely-anatomy.repository.js';
import { AnatomyController } from './interface/anatomy.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [AnatomyController],
  providers: [
    AnatomyService,
    { provide: ANATOMY_REPOSITORY, useClass: KyselyAnatomyRepository },
  ],
  exports: [AnatomyService, ANATOMY_REPOSITORY],
})
export class AnatomyModule {}
