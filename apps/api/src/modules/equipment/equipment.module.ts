import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { EquipmentService } from './application/equipment.service.js';
import { EQUIPMENT_REPOSITORY } from './domain/equipment.repository.js';
import { KyselyEquipmentRepository } from './infrastructure/kysely-equipment.repository.js';
import { EquipmentController } from './interface/equipment.controller.js';

@Module({
  imports: [OutboxModule, IamModule, InventoryModule],
  controllers: [EquipmentController],
  providers: [
    EquipmentService,
    { provide: EQUIPMENT_REPOSITORY, useClass: KyselyEquipmentRepository },
  ],
  exports: [EquipmentService, EQUIPMENT_REPOSITORY],
})
export class EquipmentModule {}
