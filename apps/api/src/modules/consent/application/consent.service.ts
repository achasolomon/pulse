import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  CONSENT_REPOSITORY,
  type ConsentPurpose,
  type ConsentRepository,
} from '../domain/consent.repository.js';

/** Consent application service (EPIC-16). Withdrawal blocks new sends; history untouched. */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(CONSENT_REPOSITORY) private readonly repo: ConsentRepository,
    private readonly outbox: OutboxService,
  ) {}

  async capture(input: {
    patientId: string;
    grantee: string;
    purpose: ConsentPurpose;
    scope: string;
    validTo?: string;
    correlationId?: string;
  }) {
    const consent = await this.repo.capture(input);
    await this.outbox.publish({
      aggregateType: 'consent',
      aggregateId: consent.id,
      type: 'consent.granted',
      producer: 'consent',
      correlationId: input.correlationId,
      payload: { id: consent.id },
    });
    return consent;
  }

  async withdraw(id: string, reason: string, opts: { correlationId?: string } = {}) {
    if (!reason) {
            throw new BadRequestException({ code: 'WITHDRAW_REASON_REQUIRED', message: 'Withdrawal requires a reason' });
    }
    await this.repo.withdraw(id, reason);
    await this.outbox.publish({
      aggregateType: 'consent',
      aggregateId: id,
      type: 'consent.withdrawn',
      producer: 'consent',
      correlationId: opts.correlationId,
      payload: { id },
    });
    return { id, status: 'withdrawn' as const };
  }

  canDisclose(input: { patientId: string; grantee: string; purpose: ConsentPurpose }) {
    return this.repo.canDisclose(input);
  }
}
