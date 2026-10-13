import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module.js';
import { ReportsService } from './application/reports.service.js';
import { REPORTS_REPOSITORY } from './domain/reports.repository.js';
import { KyselyReportsRepository } from './infrastructure/kysely-reports.repository.js';
import { ReportsController } from './interface/reports.controller.js';

@Module({
  imports: [IamModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    { provide: REPORTS_REPOSITORY, useClass: KyselyReportsRepository },
  ],
  exports: [ReportsService, REPORTS_REPOSITORY],
})
export class ReportsModule {}
