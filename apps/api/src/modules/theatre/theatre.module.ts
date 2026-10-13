import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { TheatreService } from './application/theatre.service.js';
import { THEATRE_REPOSITORY } from './domain/theatre.repository.js';
import { KyselyTheatreRepository } from './infrastructure/kysely-theatre.repository.js';
import { TheatreController } from './interface/theatre.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [TheatreController],
  providers: [
    TheatreService,
    { provide: THEATRE_REPOSITORY, useClass: KyselyTheatreRepository },
  ],
  exports: [TheatreService, THEATRE_REPOSITORY],
})
export class TheatreModule {}
