import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { SchedulingService } from './application/scheduling.service.js';
import { APPOINTMENT_REPOSITORY } from './domain/appointment.repository.js';
import { KyselyAppointmentRepository } from './infrastructure/kysely-appointment.repository.js';
import { SchedulingController } from './interface/scheduling.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [SchedulingController],
  providers: [
    SchedulingService,
    { provide: APPOINTMENT_REPOSITORY, useClass: KyselyAppointmentRepository },
  ],
  exports: [SchedulingService, APPOINTMENT_REPOSITORY],
})
export class SchedulingModule {}
