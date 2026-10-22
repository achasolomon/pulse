import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { WorkflowService } from './application/workflow.service.js';
import { WORKFLOW_REPOSITORY } from './domain/workflow.repository.js';
import { KyselyWorkflowRepository } from './infrastructure/kysely-workflow.repository.js';
import { WorkflowController } from './interface/workflow.controller.js';
import { StaffInboxController, StaffInboxGuard } from './interface/staff-inbox.controller.js';
import { StaffInboxService } from './application/staff-inbox.service.js';
import { STAFF_INBOX_REPOSITORY } from './domain/staff-inbox.repository.js';
import { KyselyStaffInboxRepository } from './infrastructure/kysely-staff-inbox.repository.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [WorkflowController, StaffInboxController],
  providers: [
    WorkflowService,
    StaffInboxService,
    StaffInboxGuard,
    { provide: STAFF_INBOX_REPOSITORY, useClass: KyselyStaffInboxRepository },
    { provide: WORKFLOW_REPOSITORY, useClass: KyselyWorkflowRepository },
  ],
  exports: [WorkflowService, WORKFLOW_REPOSITORY],
})
export class WorkflowModule {}
