import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { RevenueService } from './application/revenue.service.js';
import { BillingProjector } from './application/billing-projector.service.js';
import { REVENUE_REPOSITORY } from './domain/revenue.repository.js';
import { KyselyRevenueRepository } from './infrastructure/kysely-revenue.repository.js';
import { RevenueController } from './interface/revenue.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [RevenueController],
  providers: [
    RevenueService,
    BillingProjector,
    { provide: REVENUE_REPOSITORY, useClass: KyselyRevenueRepository },
  ],
  exports: [RevenueService, BillingProjector, REVENUE_REPOSITORY],
})
export class RevenueModule {}
