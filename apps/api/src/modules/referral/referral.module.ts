import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { ConsentModule } from '../consent/consent.module.js';
import { ReferralService } from './application/referral.service.js';
import { REFERRAL_REPOSITORY } from './domain/referral.repository.js';
import { KyselyReferralRepository } from './infrastructure/kysely-referral.repository.js';
import { ReferralController } from './interface/referral.controller.js';

@Module({
  imports: [OutboxModule, IamModule, ConsentModule],
  controllers: [ReferralController],
  providers: [
    ReferralService,
    { provide: REFERRAL_REPOSITORY, useClass: KyselyReferralRepository },
  ],
  exports: [ReferralService, REFERRAL_REPOSITORY],
})
export class ReferralModule {}
