import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { BloodbankService } from './application/bloodbank.service.js';
import { BLOODBANK_REPOSITORY } from './domain/bloodbank.repository.js';
import { KyselyBloodbankRepository } from './infrastructure/kysely-bloodbank.repository.js';
import { BloodbankController } from './interface/bloodbank.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [BloodbankController],
  providers: [
    BloodbankService,
    { provide: BLOODBANK_REPOSITORY, useClass: KyselyBloodbankRepository },
  ],
  exports: [BloodbankService, BLOODBANK_REPOSITORY],
})
export class BloodbankModule {}
