import { Module } from '@nestjs/common';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { IamModule } from '../iam/iam.module.js';
import { DocumentService } from './application/document.service.js';
import { DOCUMENT_REPOSITORY } from './domain/document.repository.js';
import { KyselyDocumentRepository } from './infrastructure/kysely-document.repository.js';
import { DocumentController } from './interface/document.controller.js';

@Module({
  imports: [OutboxModule, IamModule],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    { provide: DOCUMENT_REPOSITORY, useClass: KyselyDocumentRepository },
  ],
  exports: [DocumentService, DOCUMENT_REPOSITORY],
})
export class DocumentModule {}
