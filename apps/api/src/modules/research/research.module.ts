import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { ResearchService } from './application/research.service.js';
import { RESEARCH_REPOSITORY } from './domain/research.repository.js';
import { KyselyResearchRepository } from './infrastructure/kysely-research.repository.js';
import { ResearchController } from './interface/research.controller.js';

@Module({
  imports: [OutboxModule, IamModule, PatientModule],
  controllers: [ResearchController],
  providers: [
    ResearchService,
    { provide: RESEARCH_REPOSITORY, useClass: KyselyResearchRepository },
  ],
  exports: [ResearchService, RESEARCH_REPOSITORY],
})
export class ResearchModule {}
