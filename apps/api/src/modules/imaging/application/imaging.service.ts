import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  IMAGING_REPOSITORY,
  requiresLaterality,
  transitionImaging,
  type ImagingRepository,
} from '../domain/imaging.repository.js';

/** Imaging application service (EPIC-11 F11.1–F11.4). */
@Injectable()
export class ImagingService {
  constructor(
    @Inject(IMAGING_REPOSITORY) private readonly repo: ImagingRepository,
    private readonly outbox: OutboxService,
  ) {}

  async placeOrder(input: {
    patientId: string;
    encounterId: string;
    procedureCode: string;
    bodyRegion: string;
    laterality?: string;
    indication: string;
    urgency: 'stat' | 'urgent' | 'routine';
    correlationId?: string;
  }) {
    if (requiresLaterality(input.bodyRegion) && !input.laterality) {
      throw new BadRequestException({
        code: 'LATERALITY_REQUIRED',
        message: `Laterality is required for ${input.bodyRegion}`,
      });
    }
    const order = await this.repo.order(input);
    await this.outbox.publish({
      aggregateType: 'imaging_order',
      aggregateId: order.id,
      type: 'imaging.ordered',
      producer: 'imaging',
      correlationId: input.correlationId,
      payload: {
        id: order.id,
        patientId: input.patientId,
        encounterId: input.encounterId,
        procedureCode: input.procedureCode,
      },
    });
    return order;
  }

  private async move(
    id: string,
    action: 'schedule' | 'protocol' | 'acquire' | 'report' | 'finalize' | 'cancel',
    event: string,
    opts: { cancelReason?: string; correlationId?: string } = {},
  ) {
    const current = await this.repo.findOrder(id);
    if (!current) {
      throw new NotFoundException({ code: 'IMAGING_ORDER_NOT_FOUND', message: 'Imaging order not found' });
    }
    let status;
    try {
      status = transitionImaging(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'IMG_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    await this.repo.setStatus(id, status, opts.cancelReason);
    await this.outbox.publish({
      aggregateType: 'imaging_order',
      aggregateId: id,
      type: event,
      producer: 'imaging',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  schedule(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'schedule', 'imaging.scheduled', opts);
  }

  protocol(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'protocol', 'imaging.protocolled', opts);
  }

  acquire(
    id: string,
    study: { studyUid: string; accession: string; modality: string; pacsRef: string },
    opts: { correlationId?: string },
  ) {
    return (async () => {
      const current = await this.repo.findOrder(id);
      if (!current) {
        throw new NotFoundException({ code: 'IMAGING_ORDER_NOT_FOUND', message: 'Imaging order not found' });
      }
      if (current.status !== 'protocolled') {
        throw new UnprocessableEntityException({
          code: 'IMG_TRANSITION',
          message: `Illegal transition: ${current.status} -> acquire`,
        });
      }
      await this.repo.linkStudy(id, study);
      await this.repo.setStatus(id, 'acquired');
      await this.outbox.publish({
        aggregateType: 'imaging_order',
        aggregateId: id,
        type: 'imaging.acquired',
        producer: 'imaging',
        correlationId: opts.correlationId,
        payload: { id, studyUid: study.studyUid },
      });
      return { id, status: 'acquired' as const };
    })();
  }

  async report(id: string, input: { text: string; authorId?: string; correlationId?: string }) {
    const current = await this.repo.findOrder(id);
    if (!current) {
      throw new NotFoundException({ code: 'IMAGING_ORDER_NOT_FOUND', message: 'Imaging order not found' });
    }
    if (current.status !== 'acquired' && current.status !== 'reported') {
      throw new UnprocessableEntityException({
        code: 'IMG_TRANSITION',
        message: `Illegal transition: ${current.status} -> report`,
      });
    }
    const saved = await this.repo.saveReport(id, input);
    if (current.status === 'acquired') {
      await this.repo.setStatus(id, 'reported');
    }
    await this.outbox.publish({
      aggregateType: 'imaging_order',
      aggregateId: id,
      type: 'imaging.reported',
      producer: 'imaging',
      correlationId: input.correlationId,
      payload: { id, version: saved.version },
    });
    return saved;
  }

  finalize(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'finalize', 'imaging.finalized', opts);
  }

  cancel(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'cancel', 'imaging.cancelled', {
      cancelReason: opts.reason,
      correlationId: opts.correlationId,
    });
  }

  /** Viewer launch authorization stub (F11.3): returns the PACS ref for an authorized caller. Full signed-URL flow lands with the PACS adapter. */
  async viewerRef(orderId: string): Promise<{ pacsRef: string }> {
    return { pacsRef: `pacs://studies/${orderId}` };
  }
}
