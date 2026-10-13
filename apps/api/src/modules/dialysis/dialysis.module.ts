import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { DialysisService } from './application/dialysis.service.js';
import { DIALYSIS_REPOSITORY } from './domain/dialysis.repository.js';
import { KyselyDialysisRepository } from './infrastructure/kysely-dialysis.repository.js';
import { DialysisController } from './interface/dialysis.controller.js';

@Module({
  imports: [OutboxModule, IamModule, PatientModule],
  controllers: [DialysisController],
  providers: [
    DialysisService,
    { provide: DIALYSIS_REPOSITORY, useClass: KyselyDialysisRepository },
  ],
  exports: [DialysisService, DIALYSIS_REPOSITORY],
})
export class DialysisModule {}
