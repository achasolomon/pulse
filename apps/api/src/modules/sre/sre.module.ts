import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { AlertService } from './application/alert.service.js';
import { BackupService } from './application/backup.service.js';
import { SRE_REPOSITORY } from './domain/sre.repository.js';
import { KyselySreRepository } from './infrastructure/kysely-sre.repository.js';
import { SreController } from './interface/sre.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [SreController],
  providers: [
    AlertService,
    BackupService,
    { provide: SRE_REPOSITORY, useClass: KyselySreRepository },
  ],
  exports: [AlertService, BackupService],
})
export class SreModule {}
