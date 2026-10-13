import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { TenantContextGuard } from '../../platform/common/guards/tenant-context.guard.js';
import { IamModule } from '../iam/iam.module.js';
import { PatientModule } from '../patient/patient.module.js';
import { EncounterModule } from '../encounter/encounter.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { SyncService } from './application/sync.service.js';
import { DeviceService } from './application/device.service.js';
import { SYNC_REPOSITORY } from './domain/sync.repository.js';
import { DEVICE_REPOSITORY } from './domain/device.repository.js';
import { KyselySyncRepository } from './infrastructure/kysely-sync.repository.js';
import { KyselyDeviceRepository } from './infrastructure/kysely-device.repository.js';
import { SyncController } from './interface/sync.controller.js';
import { SyncAccessGuard } from './interface/sync-access.guard.js';

@Module({
  imports: [OutboxModule, IamModule, PatientModule, EncounterModule, ClinicalModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    DeviceService,
    SyncAccessGuard,
    TenantContextGuard,
    { provide: SYNC_REPOSITORY, useClass: KyselySyncRepository },
    { provide: DEVICE_REPOSITORY, useClass: KyselyDeviceRepository },
  ],
  exports: [SyncService, DeviceService, SYNC_REPOSITORY, DEVICE_REPOSITORY],
})
export class SyncModule {}
