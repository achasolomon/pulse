import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  REVENUE_REPOSITORY,
  type RevenueRepository,
} from '../../revenue/domain/revenue.repository.js';
import {
  INSURANCE_REPOSITORY,
  computeSplit,
  selectTariffLine,
  transitionPreauth,
  type InsuranceRepository,
  type TariffResolution,
} from '../domain/insurance.repository.js';

/**
 * Insurance application service (CR-001 Phase 1a, ADR-007).
 * `resolvePrice` is dark in Sprint 13: nothing calls it yet. Sprint 14 wires
 * it into charge capture behind an explicit design sign-off.
 */
@Injectable()
export class InsuranceService {
  constructor(
    @Inject(INSURANCE_REPOSITORY) private readonly repo: InsuranceRepository,
    private readonly outbox: OutboxService,
    @Inject(REVENUE_REPOSITORY) private readonly revenue: RevenueRepository,
  ) {}

  definePayer(input: { code: string; name: string; correlationId?: string }) {
    return this.repo.definePayer(input).then(async (payer) => {
      await this.outbox.publish({
        aggregateType: 'payer',
        aggregateId: payer.id,
        type: 'payer.defined',
        producer: 'insurance',
        correlationId: input.correlationId,
        payload: { id: payer.id, code: payer.code },
      });
      return payer;
    });
  }

  signContract(input: {
    facilityId: string;
    payerId: string;
    effectiveFrom: string;
    effectiveTo?: string;
    correlationId?: string;
  }) {
    return this.repo.signContract(input).then(async (c) => {
      await this.outbox.publish({
        aggregateType: 'contract',
        aggregateId: c.id,
        type: 'contract.signed',
        producer: 'insurance',
        correlationId: input.correlationId,
        payload: { id: c.id },
      });
      return c;
    });
  }

  async publishSchedule(
    contractId: string,
    input: { effectiveFrom: string; lines: { serviceCode: string; price: number }[]; correlationId?: string },
  ) {
    for (const line of input.lines) {
      if (!line.serviceCode || !(line.price > 0)) {
                throw new BadRequestException({
          code: 'TARIFF_LINE_INVALID',
          message: 'Each tariff line needs a serviceCode and positive price',
        });
      }
    }
    const schedule = await this.repo.publishSchedule(contractId, input.effectiveFrom);
    for (const line of input.lines) {
      await this.repo.setTariffLine(schedule.id, line.serviceCode, line.price);
    }
    await this.outbox.publish({
      aggregateType: 'tariff_schedule',
      aggregateId: schedule.id,
      type: 'tariff.published',
      producer: 'insurance',
      correlationId: input.correlationId,
      payload: { id: schedule.id, version: schedule.version },
    });
    return schedule;
  }

  /** Dark in Sprint 13: pure contract lookup, no side effects, no callers. */
  async resolvePrice(input: {
    facilityId: string;
    payerId: string;
    serviceCode: string;
    onDate: string;
  }): Promise<TariffResolution> {
    const candidates = await this.repo.candidateLines(input);
    const best = selectTariffLine(candidates, input.serviceCode);
    if (!best) return {};
    return { price: best.price, tariffId: best.id };
  }

  async defineBenefit(input: {
    payerCode: string;
    plan: string;
    deductibleAnnual: number;
    copayAmount: number;
    coinsurancePct: number;
    effectiveFrom: string;
    correlationId?: string;
  }) {
    if (input.deductibleAnnual < 0 || input.copayAmount < 0) {
            throw new BadRequestException({
        code: 'BENEFIT_RULES',
        message: 'Benefit amounts must be non-negative',
      });
    }
    if (input.coinsurancePct < 0 || input.coinsurancePct > 100) {
            throw new BadRequestException({
        code: 'BENEFIT_RULES',
        message: 'Coinsurance must be 0-100',
      });
    }
    const benefit = await this.repo.defineBenefit(input);
    await this.outbox.publish({
      aggregateType: 'plan_benefit',
      aggregateId: benefit.id,
      type: 'benefit.defined',
      producer: 'insurance',
      correlationId: input.correlationId,
      payload: { id: benefit.id },
    });
    return benefit;
  }

  /**
   * Apply plan benefits to a charge (CR-001 Phase 2a): deductible → copay →
   * coinsurance, payer takes the remainder. Writes allocation through the
   * revenue-owned port (ADR-007); deductible posts once per charge.
   */
  async applyBenefits(
    chargeId: string,
    coverageId: string,
    opts: { onDate?: string; correlationId?: string } = {},
  ) {
    const charge = await this.revenue.findCharge(chargeId);
    if (!charge) {
      throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    }
    const coverage = await this.revenue.findCoverage(coverageId);
    if (!coverage) {
      throw new NotFoundException({ code: 'COVERAGE_NOT_FOUND', message: 'Coverage not found' });
    }
    const gross = charge.quantity * charge.unitPrice;
    const onDate = opts.onDate ?? new Date().toISOString().slice(0, 10);
    const benefit = await this.repo.findBenefit(coverage.payer, coverage.plan, onDate);
    if (!benefit) {
      throw new UnprocessableEntityException({
        code: 'BENEFIT_MISSING',
        message: 'No benefit rules for this payer/plan — define them first, never guess',
      });
    }
    const year = new Date(onDate).getFullYear();
    const used = await this.repo.deductibleUsed(coverage.payer, coverage.plan, coverage.memberId, year);
    let split;
    try {
      split = computeSplit(gross, benefit, used);
    } catch {
      throw new UnprocessableEntityException({
        code: 'BENEFIT_INVALID',
        message: 'Benefit computation failed for this charge',
      });
    }
    if (split.deductibleApplied > 0) {
      await this.repo.postDeductibleUse({
        payerCode: coverage.payer,
        plan: coverage.plan,
        memberId: coverage.memberId,
        year,
        chargeId,
        amount: split.deductibleApplied,
      });
    }
    await this.revenue.allocate(chargeId, [
      {
        partyType: 'payer',
        partyRef: coverage.payer,
        sharePct: (split.payerTotal / gross) * 100,
        amount: split.payerTotal,
      },
      {
        partyType: 'patient',
        partyRef: coverage.memberId,
        sharePct: (split.patientTotal / gross) * 100,
        amount: split.patientTotal,
      },
    ]);
    await this.outbox.publish({
      aggregateType: 'charge',
      aggregateId: chargeId,
      type: 'ins.benefits_applied',
      producer: 'insurance',
      correlationId: opts.correlationId,
      payload: { id: chargeId, patientTotal: split.patientTotal, payerTotal: split.payerTotal },
    });
    return split;
  }

  /** Eligibility capture with evidence (manual or payer-query payload reference). */
  async checkEligibility(input: {
    coverageId: string;
    encounterId?: string;
    method: 'manual' | 'payer-query';
    evidence: string;
    verifiedBy?: string;
    result: 'eligible' | 'ineligible' | 'partial';
    correlationId?: string;
  }) {
    if (!input.evidence) {
            throw new BadRequestException({
        code: 'ELIGIBILITY_EVIDENCE_REQUIRED',
        message: 'Eligibility checks require evidence (note or payer response reference)',
      });
    }
    const check = await this.repo.recordEligibility(input);
    await this.outbox.publish({
      aggregateType: 'eligibility',
      aggregateId: check.id,
      type: 'eligibility.recorded',
      producer: 'insurance',
      correlationId: input.correlationId,
      payload: { id: check.id, result: input.result },
    });
    return check;
  }

  openPreauth(input: {
    coverageId: string;
    encounterId: string;
    lines: unknown[];
    correlationId?: string;
  }) {
    return this.repo.openPreauth(input).then(async (c) => {
      await this.outbox.publish({
        aggregateType: 'preauth',
        aggregateId: c.id,
        type: 'preauth.requested',
        producer: 'insurance',
        correlationId: input.correlationId,
        payload: { id: c.id },
      });
      return c;
    });
  }

  private async movePreauth(
    id: string,
    action: 'request-docs' | 'resubmit' | 'approve' | 'deny' | 'expire' | 'cancel',
    event: string,
    opts: { decisionNote?: string; expiresOn?: string; correlationId?: string } = {},
  ) {
    const current = await this.repo.findPreauth(id);
    if (!current) {
      throw new NotFoundException({ code: 'PREAUTH_NOT_FOUND', message: 'Preauth case not found' });
    }
    let status;
    try {
      status = transitionPreauth(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'PREAUTH_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    await this.repo.setPreauthStatus(id, status, opts);
    await this.outbox.publish({
      aggregateType: 'preauth',
      aggregateId: id,
      type: event,
      producer: 'insurance',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  requestPreauthDocs(id: string, opts: { correlationId?: string } = {}) {
    return this.movePreauth(id, 'request-docs', 'preauth.docs_requested', opts);
  }

  resubmitPreauth(id: string, opts: { correlationId?: string } = {}) {
    return this.movePreauth(id, 'resubmit', 'preauth.resubmitted', opts);
  }

  decidePreauth(
    id: string,
    opts: { approved: boolean; decisionNote?: string; expiresOn?: string; correlationId?: string },
  ) {
    return this.movePreauth(id, opts.approved ? 'approve' : 'deny', opts.approved ? 'preauth.approved' : 'preauth.denied', opts);
  }

  expirePreauth(id: string, opts: { correlationId?: string } = {}) {
    return this.movePreauth(id, 'expire', 'preauth.expired', opts);
  }

  cancelPreauth(id: string, opts: { correlationId?: string } = {}) {
    return this.movePreauth(id, 'cancel', 'preauth.cancelled', opts);
  }
}
