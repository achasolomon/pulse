import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { MedicationModule } from '../medication/medication.module.js';
import { RevenueModule } from '../revenue/revenue.module.js';
import { ReferralModule } from '../referral/referral.module.js';
import { LaboratoryModule } from '../laboratory/laboratory.module.js';
import { PortalService } from './application/portal.service.js';
import { PortalReadsService } from './application/portal-reads.service.js';
import { PORTAL_REPOSITORY } from './domain/portal.repository.js';
import { KyselyPortalRepository } from './infrastructure/kysely-portal.repository.js';
import { PatientSessionGuard } from './interface/patient-session.guard.js';
import { PortalAdminController, PortalController } from './interface/portal.controller.js';

@Module({
  imports: [
    OutboxModule,
    IamModule,
    PatientModule,
    SchedulingModule,
    ClinicalModule,
    MedicationModule,
    RevenueModule,
    ReferralModule,
    LaboratoryModule,
  ],
  controllers: [PortalAdminController, PortalController],
  providers: [
    PortalService,
    PortalReadsService,
    PatientSessionGuard,
    { provide: PORTAL_REPOSITORY, useClass: KyselyPortalRepository },
  ],
  exports: [PortalService, PORTAL_REPOSITORY],
})
export class PortalModule {}
