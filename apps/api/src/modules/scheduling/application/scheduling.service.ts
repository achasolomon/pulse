import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  APPOINTMENT_REPOSITORY,
  transitionAppointment,
  type AppointmentRepository,
} from '../domain/appointment.repository.js';

/** Scheduling application service (EPIC-05 F05.1–F05.4). */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    private readonly outbox: OutboxService,
  ) {}

  async book(input: {
    patientId: string;
    facilityId: string;
    departmentId?: string;
    scheduledAt: string;
    reason: string;
    correlationId?: string;
  }) {
    const appt = await this.repo.book(input);
    await this.outbox.publish({
      aggregateType: 'appointment',
      aggregateId: appt.id,
      type: 'appointment.booked',
      producer: 'scheduling',
      correlationId: input.correlationId,
      payload: { id: appt.id, patientId: input.patientId },
    });
    return appt;
  }

  private async move(
    id: string,
    action: 'check-in' | 'start' | 'complete' | 'cancel' | 'no-show' | 'reschedule',
    opts: { scheduledAt?: string; correlationId?: string },
  ) {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found' });
    let status;
    try {
      status = transitionAppointment(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'APPOINTMENT_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    const updated = await this.repo.setStatus(id, status, opts.scheduledAt);
    await this.outbox.publish({
      aggregateType: 'appointment',
      aggregateId: id,
      type: `appointment.${status}`,
      producer: 'scheduling',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return updated;
  }

  checkIn(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'check-in', opts);
  }

  start(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'start', opts);
  }

  complete(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'complete', opts);
  }

  cancel(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'cancel', opts);
  }

  markNoShow(id: string, opts: { correlationId?: string }) {
    return this.move(id, 'no-show', opts);
  }

  reschedule(id: string, opts: { scheduledAt: string; correlationId?: string }) {
    return this.move(id, 'reschedule', opts);
  }
}
