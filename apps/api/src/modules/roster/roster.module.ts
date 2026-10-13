import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { RosterService } from './application/roster.service.js';
import { ROSTER_REPOSITORY } from './domain/roster.repository.js';
import { KyselyRosterRepository } from './infrastructure/kysely-roster.repository.js';
import { RosterController } from './interface/roster.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [RosterController],
  providers: [
    RosterService,
    { provide: ROSTER_REPOSITORY, useClass: KyselyRosterRepository },
  ],
  exports: [RosterService, ROSTER_REPOSITORY],
})
export class RosterModule {}
