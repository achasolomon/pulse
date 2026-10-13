import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { SecurityEventService } from '../../../platform/security/security-event.service.js';
import {
  BREAK_GLASS_ABUSE_THRESHOLD,
  BREAK_GLASS_TTL_MS,
  BREAK_GLASS_WINDOW_MS,
  isAbusiveRepeatUse,
  isBreakGlassEligible,
  isRealBreakGlassReason,
} from '../domain/break-glass.js';
import {
  BREAK_GLASS_REPOSITORY,
  type BreakGlassRepository,
} from '../domain/break-glass.repository.js';

/**
 * Break-glass activation + monitoring (IAM-001 §31). Grants are reasoned,
 * scoped, 30-minute, and reviewable; repeat use inside 24h is denied and
 * surfaced. Without a DATABASE_URL (unit/e2e) persistence no-ops like
 * MembershipService — the demo escape hatch only; production always records.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    @Inject(BREAK_GLASS_REPOSITORY) private readonly repo: BreakGlassRepository,
    private readonly outbox: OutboxService,
    @Optional() private readonly securityEvents?: SecurityEventService,
  ) {}

  async countRecent(personId: string): Promise<number> {
    if (!process.env.DATABASE_URL) return 0;
    return this.repo.countRecent(personId, this.windowStart());
  }

  async activate(input: {
    personId: string;
    facilityId: string;
    patientId?: string;
    resourceType: string;
    action: string;
    reason: string;
  }): Promise<{ grantId: string; expiresAt: Date }> {
    if (!isRealBreakGlassReason(input.reason)) {
      throw new ForbiddenException({
        code: 'BREAK_GLASS_REASON_REQUIRED',
        message: 'Break-glass requires a specific emergency justification',
      });
    }
    if (!isBreakGlassEligible(input.resourceType, input.action)) {
      throw new ForbiddenException({
        code: 'DENY_BREAK_GLASS_INELIGIBLE',
        message: 'Break-glass covers clinical patient data only',
      });
    }
    if (!process.env.DATABASE_URL) {
      return { grantId: 'demo-grant', expiresAt: this.ttlEnd() };
    }
    const recent = await this.repo.countRecent(input.personId, this.windowStart());
    if (isAbusiveRepeatUse(recent)) {
      throw new ForbiddenException({
        code: 'DENY_BREAK_GLASS_ABUSE',
        message: `Break-glass denied: ${recent} grants in 24h (threshold ${BREAK_GLASS_ABUSE_THRESHOLD})`,
      });
    }
    const grant = await this.repo.create({
      personId: input.personId,
      facilityId: input.facilityId,
      ...(input.patientId ? { patientId: input.patientId } : {}),
      resourceType: input.resourceType,
      action: input.action,
      reason: input.reason,
      expiresAt: this.ttlEnd(),
    });
    await this.outbox.publish({
      aggregateType: 'break_glass_grant',
      aggregateId: grant.id,
      type: 'BreakGlassActivated',
      producer: 'iam',
      payload: {
        id: grant.id,
        personId: input.personId,
        facilityId: input.facilityId,
        resourceType: input.resourceType,
        action: input.action,
      },
    });
    // SIEM feed (SEC-001 61: break-glass/mass patient access signal).
    await this.securityEvents?.record({
      category: 'break_glass',
      action: 'break_glass.activated',
      severity: 'high',
      actorType: 'person',
      actorId: input.personId,
      facilityId: input.facilityId,
      details: { grantId: grant.id, resourceType: input.resourceType, action: input.action },
    });
    return { grantId: grant.id, expiresAt: grant.expiresAt };
  }

  /** Marks lapsed grants and emits BreakGlassExpired (cron-schedulable). */
  async sweepExpired(): Promise<number> {
    if (!process.env.DATABASE_URL) return 0;
    const lapsed = await this.repo.expireDue(new Date());
    for (const g of lapsed) {
      await this.outbox.publish({
        aggregateType: 'break_glass_grant',
        aggregateId: g.id,
        type: 'BreakGlassExpired',
        producer: 'iam',
        payload: { id: g.id, personId: g.personId },
      });
    }
    return lapsed.length;
  }

  private windowStart(): Date {
    return new Date(Date.now() - BREAK_GLASS_WINDOW_MS);
  }

  private ttlEnd(): Date {
    return new Date(Date.now() + BREAK_GLASS_TTL_MS);
  }
}
