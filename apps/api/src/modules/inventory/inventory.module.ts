import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { InventoryService } from './application/inventory.service.js';
import { INVENTORY_REPOSITORY } from './domain/inventory.repository.js';
import { KyselyInventoryRepository } from './infrastructure/kysely-inventory.repository.js';
import { InventoryController } from './interface/inventory.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    { provide: INVENTORY_REPOSITORY, useClass: KyselyInventoryRepository },
  ],
  exports: [InventoryService, INVENTORY_REPOSITORY],
})
export class InventoryModule {}
