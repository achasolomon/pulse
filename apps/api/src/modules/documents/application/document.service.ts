import { Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from '../domain/document.repository.js';

/** Document application service (EPIC-15 F15.3). Upload bytes go to S3/MinIO; this registers metadata. */
@Injectable()
export class DocumentService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository,
    private readonly outbox: OutboxService,
  ) {}

  async register(input: {
    patientId?: string;
    encounterId?: string;
    name: string;
    mime: string;
    storageKey: string;
    correlationId?: string;
  }) {
    const doc = await this.repo.register(input);
    await this.outbox.publish({
      aggregateType: 'document',
      aggregateId: doc.id,
      type: 'document.registered',
      producer: 'documents',
      correlationId: input.correlationId,
      payload: { id: doc.id },
    });
    return doc;
  }
}
