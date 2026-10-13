import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { IamModule } from '../iam/iam.module.js';
import { BedflowService } from './application/bedflow.service.js';
import { BEDFLOW_REPOSITORY } from './domain/bedflow.repository.js';
import { KyselyBedflowRepository } from './infrastructure/kysely-bedflow.repository.js';
import { BedflowController, LevelController } from './interface/bedflow.controller.js';

@Module({
  imports: [OutboxModule, IamModule, EncounterModule],
  controllers: [BedflowController, LevelController],
  providers: [
    BedflowService,
    { provide: BEDFLOW_REPOSITORY, useClass: KyselyBedflowRepository },
  ],
  exports: [BedflowService, BEDFLOW_REPOSITORY],
})
export class BedflowModule {}
