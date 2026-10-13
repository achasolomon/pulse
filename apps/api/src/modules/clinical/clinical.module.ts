import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DocumentModule } from '../documents/documents.module.js';
import { ClinicalService } from './application/clinical.service.js';
import { CLINICAL_REPOSITORY } from './domain/clinical.repository.js';
import { KyselyClinicalRepository } from './infrastructure/kysely-clinical.repository.js';
import { ClinicalController } from './interface/clinical.controller.js';

@Module({
  imports: [OutboxModule, IamModule, EncounterModule, PatientModule, WorkflowModule, DocumentModule],
  controllers: [ClinicalController],
  providers: [
    ClinicalService,
    { provide: CLINICAL_REPOSITORY, useClass: KyselyClinicalRepository },
  ],
  exports: [ClinicalService, CLINICAL_REPOSITORY],
})
export class ClinicalModule {}
