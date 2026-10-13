import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  CONSENT_REPOSITORY,
  type ConsentRepository,
} from '../../consent/domain/consent.repository.js';
import {
  REFERRAL_REPOSITORY,
  transitionReferral,
  type ReferralRepository,
} from '../domain/referral.repository.js';

/**
 * Referral application service (EPIC-17). Consent-gated sends (EPIC-16):
 * submit/accept/dispatch require an active referral-purpose grant for the
 * receiving facility; withdrawal blocks new sends, never rewrites history.
 */
@Injectable()
export class ReferralService {
  constructor(
    @Inject(REFERRAL_REPOSITORY) private readonly repo: ReferralRepository,
    @Inject(CONSENT_REPOSITORY) private readonly consent: ConsentRepository,
    private readonly outbox: OutboxService,
  ) {}

  create(input: {
    patientId: string;
    sendingFacilityId: string;
    receivingFacilityId?: string;
    type: string;
    urgency: string;
    clinicalQuestion: string;
    correlationId?: string;
  }) {
    return this.repo.create(input).then(async (c) => {
      await this.outbox.publish({
        aggregateType: 'referral_case',
        aggregateId: c.id,
        type: 'referral.drafted',
        producer: 'referral',
        correlationId: input.correlationId,
        payload: { id: c.id },
      });
      return c;
    });
  }

  private async move(
    id: string,
    action:
      | 'submit'
      | 'acknowledge'
      | 'request-info'
      | 'resubmit'
      | 'accept'
      | 'decline'
      | 'schedule'
      | 'dispatch'
      | 'arrive'
      | 'close'
      | 'cancel'
      | 'expire'
      | 'redirect',
    event: string,
    opts: {
      receivingFacilityId?: string;
      cancelReason?: string;
      package?: Record<string, unknown>;
      correlationId?: string;
    } = {},
  ) {
    const current = await this.repo.findCase(id);
    if (!current) {
      throw new NotFoundException({ code: 'REFERRAL_NOT_FOUND', message: 'Referral case not found' });
    }
    let status;
    try {
      status = transitionReferral(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'REFERRAL_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    // Consent gate on every outward send.
    if (['submit', 'resubmit', 'redirect', 'accept', 'dispatch'].includes(action)) {
      const grantee = opts.receivingFacilityId ?? current.receivingFacilityId ?? current.sendingFacilityId;
      const allowed = await this.consent.canDisclose({
        patientId: current.patientId,
        grantee,
        purpose: 'referral',
      });
      if (!allowed) {
        throw new UnprocessableEntityException({
          code: 'CONSENT_REQUIRED',
          message: 'Active referral consent for the receiving facility is required',
        });
      }
      await this.consent.logDisclosure({
        patientId: current.patientId,
        grantee,
        purpose: 'referral',
        caseId: id,
      });
    }
    await this.repo.setStatus(id, status, {
      ...(opts.receivingFacilityId ? { receivingFacilityId: opts.receivingFacilityId } : {}),
      ...(opts.cancelReason ? { cancelReason: opts.cancelReason } : {}),
    });
    if (opts.package) {
      await this.repo.savePackage(id, opts.package);
    }
    await this.outbox.publish({
      aggregateType: 'referral_case',
      aggregateId: id,
      type: event,
      producer: 'referral',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  submit(id: string, opts: { package?: Record<string, unknown>; correlationId?: string } = {}) {
    return this.move(id, 'submit', 'referral.submitted', opts);
  }

  acknowledge(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'acknowledge', 'referral.acknowledged', opts);
  }

  requestInfo(id: string, message: string, authorId?: string, opts: { correlationId?: string } = {}) {
    return this.repo.addMessage(id, authorId, message).then(() => this.move(id, 'request-info', 'referral.info_requested', opts));
  }

  resubmit(id: string, opts: { package?: Record<string, unknown>; correlationId?: string } = {}) {
    return this.move(id, 'resubmit', 'referral.resubmitted', opts);
  }

  accept(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'accept', 'referral.accepted', opts);
  }

  decline(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'decline', 'referral.declined', opts);
  }

  schedule(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'schedule', 'referral.scheduled', opts);
  }

  dispatch(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'dispatch', 'referral.in_transit', opts);
  }

  arrive(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'arrive', 'referral.arrived', opts);
  }

  close(id: string, opts: { correlationId?: string } = {}) {
    return this.move(id, 'close', 'referral.closed', opts);
  }

  cancel(id: string, opts: { reason: string; correlationId?: string }) {
    return this.move(id, 'cancel', 'referral.cancelled', { cancelReason: opts.reason, correlationId: opts.correlationId });
  }

  redirect(
    id: string,
    opts: { receivingFacilityId: string; package?: Record<string, unknown>; correlationId?: string },
  ) {
    // New routing history; original routing retained in package versions + disclosure log.
    return this.move(id, 'redirect', 'referral.redirected', opts);
  }

  message(id: string, body: string, authorId?: string) {
    if (!body) {
      return Promise.reject(new UnprocessableEntityException({
        code: 'MESSAGE_REQUIRED',
        message: 'Message body is required',
      }));
    }
    return this.repo.addMessage(id, authorId, body);
  }
}
