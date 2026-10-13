import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { WorkflowService } from './application/workflow.service.js';
import { WORKFLOW_REPOSITORY } from './domain/workflow.repository.js';
import { KyselyWorkflowRepository } from './infrastructure/kysely-workflow.repository.js';
import { WorkflowController } from './interface/workflow.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    { provide: WORKFLOW_REPOSITORY, useClass: KyselyWorkflowRepository },
  ],
  exports: [WorkflowService, WORKFLOW_REPOSITORY],
})
export class WorkflowModule {}
