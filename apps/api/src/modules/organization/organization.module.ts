import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { OrganizationService } from './application/organization.service.js';
import { ORGANIZATION_REPOSITORY } from './application/organization.repository.js';
import { KyselyOrganizationRepository } from './infrastructure/kysely-organization.repository.js';
import { OrganizationController } from './interface/organization.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    { provide: ORGANIZATION_REPOSITORY, useClass: KyselyOrganizationRepository },
  ],
  exports: [OrganizationService, ORGANIZATION_REPOSITORY],
})
export class OrganizationModule {}
