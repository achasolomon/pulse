import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  WORKFLOW_REPOSITORY,
  transitionTask,
  type WorkflowRepository,
} from '../domain/workflow.repository.js';

/** Workflow application service (EPIC-15 F15.1/F15.2). Delivery adapters later; records + events now. */
@Injectable()
export class WorkflowService {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly repo: WorkflowRepository,
    private readonly outbox: OutboxService,
  ) {}

  async createTask(input: {
    kind: string;
    patientId?: string;
    facilityId: string;
    payload?: Record<string, unknown>;
    dueAt?: string;
    correlationId?: string;
  }) {
    const task = await this.repo.createTask({
      kind: input.kind,
      ...(input.patientId ? { patientId: input.patientId } : {}),
      facilityId: input.facilityId,
      payload: input.payload ?? {},
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    });
    await this.outbox.publish({
      aggregateType: 'task',
      aggregateId: task.id,
      type: 'task.created',
      producer: 'workflow',
      correlationId: input.correlationId,
      payload: { id: task.id, kind: input.kind },
    });
    return task;
  }

  async transition(id: string, action: 'complete' | 'escalate' | 'cancel', opts: { correlationId?: string } = {}) {
    const current = await this.repo.findTask(id);
    if (!current) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
    }
    let to;
    try {
      to = transitionTask(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'TASK_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    await this.repo.setTaskStatus(id, to);
    await this.outbox.publish({
      aggregateType: 'task',
      aggregateId: id,
      type: `task.${to}`,
      producer: 'workflow',
      correlationId: opts.correlationId,
      payload: { id },
    });
    return { id, status: to };
  }

  async notify(input: {
    channel: 'in-app' | 'sms' | 'email';
    recipient: string;
    body: string;
    correlationId?: string;
  }) {
    if (!input.body || !input.recipient) {
            throw new BadRequestException({ code: 'NOTIFY_REQUIRED', message: 'Recipient and body are required' });
    }
    const n = await this.repo.notify(input);
    await this.outbox.publish({
      aggregateType: 'notification',
      aggregateId: n.id,
      type: 'notification.queued',
      producer: 'workflow',
      correlationId: input.correlationId,
      payload: { id: n.id, channel: input.channel },
    });
    return n;
  }
}
