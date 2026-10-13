import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { FindingService } from './application/finding.service.js';
import { SiemService } from './application/siem.service.js';
import { FINDING_REPOSITORY } from './domain/finding.repository.js';
import { SECURITY_EVENT_REPOSITORY } from './domain/security-event.repository.js';
import { KyselyFindingRepository } from './infrastructure/kysely-finding.repository.js';
import { KyselySecurityEventRepository } from './infrastructure/kysely-security-event.repository.js';
import { SecurityController } from './interface/security.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [SecurityController],
  providers: [
    FindingService,
    SiemService,
    { provide: FINDING_REPOSITORY, useClass: KyselyFindingRepository },
    { provide: SECURITY_EVENT_REPOSITORY, useClass: KyselySecurityEventRepository },
  ],
  exports: [FindingService, SiemService],
})
export class SecurityModule {}
