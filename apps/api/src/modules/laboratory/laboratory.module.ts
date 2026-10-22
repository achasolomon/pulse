import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { LaboratoryService } from './application/laboratory.service.js';
import { LAB_REPOSITORY } from './domain/lab.repository.js';
import { KyselyLabRepository } from './infrastructure/kysely-lab.repository.js';
import { LaboratoryController } from './interface/laboratory.controller.js';
import {PatientModule} from '../patient/patient.module.js';
import {StaffLabController} from './interface/staff-lab.controller.js';
import {STAFF_LAB_REPOSITORY} from './domain/staff-lab.repository.js';
import {KyselyStaffLabRepository} from './infrastructure/kysely-staff-lab.repository.js';
import {StaffLabWorkflowController} from './interface/staff-lab-workflow.controller.js';
import {STAFF_LAB_WORKFLOW_REPOSITORY} from './domain/staff-lab-workflow.repository.js';
import {KyselyStaffLabWorkflowRepository} from './infrastructure/kysely-staff-lab-workflow.repository.js';
import {StaffCriticalController} from './interface/staff-critical.controller.js';
import {STAFF_CRITICAL_REPOSITORY} from './domain/staff-critical.repository.js';
import {KyselyStaffCriticalRepository} from './infrastructure/kysely-staff-critical.repository.js';
import {CriticalEscalationService} from './application/critical-escalation.service.js';

@Module({
  imports: [OutboxModule, IamModule,PatientModule],
  controllers: [LaboratoryController,StaffLabController,StaffLabWorkflowController,StaffCriticalController],
  providers: [
    CriticalEscalationService,
    {provide:STAFF_CRITICAL_REPOSITORY,useClass:KyselyStaffCriticalRepository},
    {provide:STAFF_LAB_WORKFLOW_REPOSITORY,useClass:KyselyStaffLabWorkflowRepository},
    {provide:STAFF_LAB_REPOSITORY,useClass:KyselyStaffLabRepository},
    LaboratoryService,
    { provide: LAB_REPOSITORY, useClass: KyselyLabRepository },
  ],
  exports: [LaboratoryService, LAB_REPOSITORY],
})
export class LaboratoryModule {}
