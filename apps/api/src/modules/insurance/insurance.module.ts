import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { RevenueModule } from '../revenue/revenue.module.js';
import { InsuranceService } from './application/insurance.service.js';
import { INSURANCE_REPOSITORY } from './domain/insurance.repository.js';
import { KyselyInsuranceRepository } from './infrastructure/kysely-insurance.repository.js';
import { InsuranceController } from './interface/insurance.controller.js';

@Module({
  imports: [OutboxModule, IamModule, RevenueModule],
  controllers: [InsuranceController],
  providers: [
    InsuranceService,
    { provide: INSURANCE_REPOSITORY, useClass: KyselyInsuranceRepository },
  ],
  exports: [InsuranceService, INSURANCE_REPOSITORY],
})
export class InsuranceModule {}
