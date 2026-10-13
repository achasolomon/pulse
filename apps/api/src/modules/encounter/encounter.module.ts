import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { EncounterService } from './application/encounter.service.js';
import { ENCOUNTER_REPOSITORY } from './domain/encounter.repository.js';
import { KyselyEncounterRepository } from './infrastructure/kysely-encounter.repository.js';
import { EncounterController } from './interface/encounter.controller.js';

@Module({
  imports: [OutboxModule, IamModule, PatientModule],
  controllers: [EncounterController],
  providers: [
    EncounterService,
    { provide: ENCOUNTER_REPOSITORY, useClass: KyselyEncounterRepository },
  ],
  exports: [EncounterService, ENCOUNTER_REPOSITORY],
})
export class EncounterModule {}
