import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { MedicationService } from './application/medication.service.js';
import { MEDICATION_REPOSITORY } from './domain/medication.repository.js';
import { KyselyMedicationRepository } from './infrastructure/kysely-medication.repository.js';
import { MedicationController } from './interface/medication.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [MedicationController],
  providers: [
    MedicationService,
    { provide: MEDICATION_REPOSITORY, useClass: KyselyMedicationRepository },
  ],
  exports: [MedicationService, MEDICATION_REPOSITORY],
})
export class MedicationModule {}
