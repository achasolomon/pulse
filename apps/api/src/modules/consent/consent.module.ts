import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { ConsentService } from './application/consent.service.js';
import { CONSENT_REPOSITORY } from './domain/consent.repository.js';
import { KyselyConsentRepository } from './infrastructure/kysely-consent.repository.js';
import { ConsentController } from './interface/consent.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [ConsentController],
  providers: [
    ConsentService,
    { provide: CONSENT_REPOSITORY, useClass: KyselyConsentRepository },
  ],
  exports: [ConsentService, CONSENT_REPOSITORY],
})
export class ConsentModule {}
