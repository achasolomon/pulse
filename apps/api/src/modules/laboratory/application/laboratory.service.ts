import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  LAB_REPOSITORY,
  transitionLabOrder,
  type LabRepository,
  type LabUrgency,
} from '../domain/lab.repository.js';

/** Laboratory application service (EPIC-10 F10.1–F10.5 + EPIC-09 order semantics). */
@Injectable()
export class LaboratoryService {
  constructor(
    @Inject(LAB_REPOSITORY) private readonly repo: LabRepository,
    private readonly outbox: OutboxService,
  ) {}

  defineTest(input: { code: string; name: string; specimenRequirement: string }) {
    return this.repo.upsertTest(input);
  }

  async placeOrder(input: {
    patientId: string;
    encounterId: string;
    testCode: string;
    urgency: LabUrgency;
    indication: string;
    correlationId?: string;
  }) {
    const test = await this.repo.findTest(input.testCode);
    if (!test) {
      throw new BadRequestException({
        code: 'UNKNOWN_TEST',
        message: `No active catalogue entry for ${input.testCode}`,
      });
    }
    const order = await this.repo.order({
      patientId: input.patientId,
      encounterId: input.encounterId,
      testId: test.id,
      testVersion: test.version,
      urgency: input.urgency,
      indication: input.indication,
    });
    await this.outbox.publish({
      aggregateType: 'lab_order',
      aggregateId: order.id,
      type: 'lab.ordered',
      producer: 'laboratory',
      correlationId: input.correlationId,
      payload: { id: order.id, testCode: input.testCode, patientId: input.patientId, encounterId: input.encounterId },
    });
    return order;
  }

  private async move(
    id: string,
    action: 'collect' | 'accession' | 'result' | 'verify' | 'cancel',
    event: string,
    opts: {
      container?: string;
      label?: string;
      cancelReason?: string;
      verifiedBy?: string;
      correlationId?: string;
    } = {},
  ) {
    const current = await this.repo.findOrder(id);
    if (!current) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found' });
    }
    let status;
    try {
      status = transitionLabOrder(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'LAB_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    if (action === 'collect') {
      if (!opts.container || !opts.label) {
        throw new BadRequestException({
          code: 'SPECIMEN_REQUIRED',
          message: 'Container and label are required for collection',
        });
      }
      await this.repo.collectSpecimen(id, { container: opts.container, label: opts.label });
    }
    const updated = await this.repo.setStatus(id, status, {
      ...(opts.cancelReason ? { cancelReason: opts.cancelReason } : {}),
      ...(opts.verifiedBy ? { verifiedBy: opts.verifiedBy } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'lab_order',
      aggregateId: id,
      type: event,
      producer: 'laboratory',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return updated;
  }

  collect(id: string, opts: { container: string; label: string; correlationId?: string }) {
    return this.move(id, 'collect', `lab.collected`, opts);
  }

  accession(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'accession', 'lab.accessioned', opts);
  }

  async result(
    id: string,
    input: {
      component: string;
      valueText: string;
      unit?: string;
      flag?: 'normal' | 'high' | 'low' | 'critical';
      correlationId?: string;
    },
  ) {
    const current = await this.repo.findOrder(id);
    if (!current) {
      throw new NotFoundException({ code: 'LAB_ORDER_NOT_FOUND', message: 'Lab order not found' });
    }
    if (current.status !== 'accessioned' && current.status !== 'resulted') {
      throw new UnprocessableEntityException({
        code: 'LAB_TRANSITION',
        message: `Illegal transition: ${current.status} -> result`,
      });
    }
    const added = await this.repo.addResult(id, input);
    if (current.status === 'accessioned') {
      await this.repo.setStatus(id, 'resulted');
    }
    await this.outbox.publish({
      aggregateType: 'lab_order',
      aggregateId: id,
      type: added.critical ? 'lab.critical_result' : 'lab.resulted',
      producer: 'laboratory',
      correlationId: input.correlationId,
      payload: { id, component: input.component, critical: added.critical },
    });
    return added;
  }

  verify(id: string, opts: { verifiedBy: string; correlationId?: string }) {
    return this.move(id, 'verify', 'lab.verified', opts);
  }

  cancel(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'cancel', 'lab.cancelled', {
      cancelReason: opts.reason,
      correlationId: opts.correlationId,
    });
  }

  async acknowledgeCritical(id: string, opts: { ackBy: string; correlationId?: string }) {
    await this.repo.acknowledgeCritical(id, opts.ackBy);
    await this.outbox.publish({
      aggregateType: 'lab_order',
      aggregateId: id,
      type: 'lab.critical_acknowledged',
      producer: 'laboratory',
      correlationId: opts.correlationId,
      payload: { id, ackBy: opts.ackBy },
    });
    return { ok: true };
  }
}
