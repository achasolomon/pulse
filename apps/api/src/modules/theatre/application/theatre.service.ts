import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  THEATRE_REPOSITORY,
  assertChecklistStage,
  transitionBooking,
  type ChecklistStage,
  type TheatreRepository,
} from '../domain/theatre.repository.js';

/** Theatre application service (R6 slice). Checklist order is a safety control, not guidance. */
@Injectable()
export class TheatreService {
  constructor(
    @Inject(THEATRE_REPOSITORY) private readonly repo: TheatreRepository,
    private readonly outbox: OutboxService,
  ) {}

  defineSuite(facilityId: string, name: string, code: string) {
    return this.repo.defineSuite(facilityId, name, code);
  }

  async book(input: {
    encounterId: string;
    suiteId: string;
    procedureName: string;
    urgency: string;
    scheduledAt: string;
    correlationId?: string;
  }) {
    const booking = await this.repo.book(input);
    await this.outbox.publish({
      aggregateType: 'theatre_booking',
      aggregateId: booking.id,
      type: 'theatre.booked',
      producer: 'theatre',
      correlationId: input.correlationId,
      payload: { id: booking.id },
    });
    return booking;
  }

  private async move(
    id: string,
    action: 'check-in' | 'start' | 'complete' | 'cancel',
    event: string,
    opts: { cancelReason?: string; correlationId?: string } = {},
  ) {
    const current = await this.repo.findBooking(id);
    if (!current) {
      throw new NotFoundException({ code: 'THEATRE_BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    let status;
    try {
      status = transitionBooking(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'THEATRE_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    if (action === 'complete') {
      // Safety control: the case cannot close until sign-out is recorded.
      const done = await this.repo.completedStages(id);
      if (!done.includes('sign-out')) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_INCOMPLETE',
          message: 'Sign-out must complete before the case can close',
        });
      }
    }
    await this.repo.setBookingStatus(id, status, opts.cancelReason);
    await this.outbox.publish({
      aggregateType: 'theatre_booking',
      aggregateId: id,
      type: event,
      producer: 'theatre',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  checkIn(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'check-in', 'theatre.checked_in', opts);
  }

  start(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'start', 'theatre.started', opts);
  }

  complete(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'complete', 'theatre.completed', opts);
  }

  cancel(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'cancel', 'theatre.cancelled', { cancelReason: opts.reason, correlationId: opts.correlationId });
  }

  async checklist(
    bookingId: string,
    stage: ChecklistStage,
    items: unknown[],
    opts: { completedBy?: string; correlationId?: string } = {},
  ) {
    const booking = await this.repo.findBooking(bookingId);
    if (!booking) {
      throw new NotFoundException({ code: 'THEATRE_BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    if (booking.status !== 'in-progress') {
      throw new UnprocessableEntityException({
        code: 'CHECKLIST_TIMING',
        message: 'Checklist stages complete while the case is in progress',
      });
    }
    const done = await this.repo.completedStages(bookingId);
    try {
      assertChecklistStage(done, stage);
    } catch {
      throw new UnprocessableEntityException({
        code: 'CHECKLIST_ORDER',
        message: `Stages complete strictly in order (sign-in, time-out, sign-out)`,
      });
    }
    await this.repo.completeStage(bookingId, stage, items, opts.completedBy);
    await this.outbox.publish({
      aggregateType: 'theatre_booking',
      aggregateId: bookingId,
      type: `theatre.checklist_${stage.replace('-', '_')}`,
      producer: 'theatre',
      correlationId: opts.correlationId,
      payload: { id: bookingId, stage },
    });
    return { bookingId, stage };
  }

  record(
    bookingId: string,
    input: { surgeon: string; anesthetist: string; notes: string; startedAt?: string; endedAt?: string },
  ) {
    return this.repo.saveRecord(bookingId, input);
  }
}
