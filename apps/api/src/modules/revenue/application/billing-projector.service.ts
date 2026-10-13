import { Inject, Injectable } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  REVENUE_REPOSITORY,
  type RevenueRepository,
} from '../domain/revenue.repository.js';

/**
 * Charge projector (CR-001 Phase 2b billing automation). Turns committed
 * clinical facts into draft charges without manual capture:
 * - reads active rules + peeks unpublished outbox events (never marks them)
 * - resolves the service code per rule (fixed code or payload field)
 * - captures with source_event_id, so re-runs create zero duplicates
 * - unknown/unmapped events are skipped, never failed
 */
@Injectable()
export class BillingProjector {
  constructor(
    @Inject(REVENUE_REPOSITORY) private readonly repo: RevenueRepository,
    private readonly outbox: OutboxService,
  ) {}

  async project(opts: { limit?: number; correlationId?: string } = {}) {
    const rules = await this.repo.activeRules();
    if (rules.length === 0) return { projected: 0, skipped: 0 };
    const events = await this.outbox.peekUnpublished(
      rules.map((r) => r.eventType),
      opts.limit ?? 100,
    );
    let projected = 0;
    let skipped = 0;
    for (const event of events) {
      const rule = rules.find((r) => r.eventType === event.type);
      if (!rule) {
        skipped++;
        continue;
      }
      const fromPayload =
        rule.codeField && typeof event.payload[rule.codeField] === 'string'
          ? (event.payload[rule.codeField] as string)
          : undefined;
      const serviceCode = rule.serviceCode ?? fromPayload;
      const patientId =
        typeof event.payload['patientId'] === 'string'
          ? (event.payload['patientId'] as string)
          : undefined;
      if (!serviceCode || !patientId) {
        skipped++;
        continue;
      }
      const existing = await this.repo.findChargeBySourceEvent(event.eventId);
      if (existing) {
        skipped++;
        continue;
      }
      const service = await this.repo.findService(serviceCode);
      if (!service) {
        skipped++;
        continue;
      }
      const encounterId =
        typeof event.payload['encounterId'] === 'string'
          ? (event.payload['encounterId'] as string)
          : undefined;
      await this.repo.captureCharge({
        patientId,
        ...(encounterId ? { encounterId } : {}),
        serviceCode,
        quantity: rule.quantity,
        unitPrice: service.defaultPrice,
        sourceEventId: event.eventId,
      });
      projected++;
    }
    return { projected, skipped };
  }
}
