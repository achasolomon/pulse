import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { EmergencyService } from './application/emergency.service.js';
import { EMERGENCY_REPOSITORY } from './domain/emergency.repository.js';
import { KyselyEmergencyRepository } from './infrastructure/kysely-emergency.repository.js';
import { EmergencyController } from './interface/emergency.controller.js';

@Module({
  imports: [OutboxModule, IamModule, EncounterModule],
  controllers: [EmergencyController],
  providers: [
    EmergencyService,
    { provide: EMERGENCY_REPOSITORY, useClass: KyselyEmergencyRepository },
  ],
  exports: [EmergencyService, EMERGENCY_REPOSITORY],
})
export class EmergencyModule {}
