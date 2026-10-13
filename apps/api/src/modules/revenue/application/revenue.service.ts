import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  REVENUE_REPOSITORY,
  checkAllocation,
  invoiceBalance,
  transitionClaim,
  type AllocationShare,
  type ClaimStatus,
  type InvoiceStatus,
  type RevenueRepository,
} from '../domain/revenue.repository.js';

/** Revenue application service (EPIC-14 F14.1–F14.5). Clinical state never touched here. */
@Injectable()
export class RevenueService {
  constructor(
    @Inject(REVENUE_REPOSITORY) private readonly repo: RevenueRepository,
    private readonly outbox: OutboxService,
  ) {}

  defineService(input: { code: string; name: string; defaultPrice: number }) {
    return this.repo.defineService(input);
  }

  async captureCharge(input: {
    patientId: string;
    encounterId?: string;
    serviceCode: string;
    quantity: number;
    unitPrice?: number;
    correlationId?: string;
  }) {
    if (input.quantity <= 0) {
      throw new BadRequestException({ code: 'QTY_POSITIVE', message: 'Quantity must be positive' });
    }
    let unitPrice = input.unitPrice;
    if (unitPrice === undefined) {
      const svc = await this.repo.findService(input.serviceCode);
      if (!svc) {
        throw new BadRequestException({
          code: 'UNKNOWN_SERVICE',
          message: `No catalogue entry for ${input.serviceCode}`,
        });
      }
      unitPrice = svc.defaultPrice;
    }
    const charge = await this.repo.captureCharge({
      patientId: input.patientId,
      ...(input.encounterId ? { encounterId: input.encounterId } : {}),
      serviceCode: input.serviceCode,
      quantity: input.quantity,
      unitPrice,
    });
    await this.outbox.publish({
      aggregateType: 'charge',
      aggregateId: charge.id,
      type: 'charge.captured',
      producer: 'revenue',
      correlationId: input.correlationId,
      payload: { id: charge.id },
    });
    return charge;
  }

  async invoice(input: { patientId: string; chargeIds: string[]; correlationId?: string }) {
    const invoice = await this.repo.createInvoice(input.patientId);
    for (const chargeId of input.chargeIds) {
      const charge = await this.repo.findCharge(chargeId);
      if (!charge) {
        throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: `Charge ${chargeId} not found` });
      }
      await this.repo.addLine(invoice.id, chargeId, charge.quantity * charge.unitPrice);
    }
    await this.outbox.publish({
      aggregateType: 'invoice',
      aggregateId: invoice.id,
      type: 'invoice.created',
      producer: 'revenue',
      correlationId: input.correlationId,
      payload: { id: invoice.id },
    });
    return invoice;
  }

  async setInvoiceStatus(id: string, status: InvoiceStatus, voidReason?: string) {
    if (status === 'void' && !voidReason) {
      throw new BadRequestException({ code: 'VOID_REASON_REQUIRED', message: 'Void requires a reason' });
    }
    await this.repo.setInvoiceStatus(id, status, voidReason);
    return { id, status };
  }

  async pay(invoiceId: string, input: { amount: number; method: string; correlationId?: string }) {
    if (input.amount <= 0) {
      throw new BadRequestException({ code: 'AMOUNT_POSITIVE', message: 'Payment amount must be positive' });
    }
    const payment = await this.repo.recordPayment(invoiceId, input.amount, input.method);
    await this.refreshInvoicePaidState(invoiceId);
    await this.outbox.publish({
      aggregateType: 'invoice',
      aggregateId: invoiceId,
      type: 'payment.recorded',
      producer: 'revenue',
      correlationId: input.correlationId,
      payload: { id: payment.id },
    });
    return payment;
  }

  async adjust(
    invoiceId: string,
    input: { amount: number; kind: 'refund' | 'write-off' | 'correction'; reason: string; correlationId?: string },
  ) {
    if (input.amount <= 0 || !input.reason) {
      throw new BadRequestException({ code: 'ADJUST_INVALID', message: 'Positive amount and reason required' });
    }
    const adj = await this.repo.recordAdjustment(invoiceId, input.amount, input.kind, input.reason);
    await this.outbox.publish({
      aggregateType: 'invoice',
      aggregateId: invoiceId,
      type: 'invoice.adjusted',
      producer: 'revenue',
      correlationId: input.correlationId,
      payload: { id: adj.id, kind: input.kind },
    });
    return adj;
  }

  async balance(invoiceId: string) {
    const { lines } = await this.repo.invoiceTotals(invoiceId);
    const payments = await this.repo.paymentsFor(invoiceId);
    const adjustments = await this.repo.adjustmentsFor(invoiceId);
    return invoiceBalance({ lines, payments, adjustments });
  }

  private async refreshInvoicePaidState(invoiceId: string): Promise<void> {
    const b = await this.balance(invoiceId);
    if (b.outstanding <= 0 && b.total > 0) {
      await this.repo.setInvoiceStatus(invoiceId, 'paid');
    } else if (b.paid > 0) {
      await this.repo.setInvoiceStatus(invoiceId, 'partial');
    }
  }

  addCoverage(input: {
    patientId: string;
    payer: string;
    plan: string;
    memberId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }) {
    return this.repo.addCoverage(input);
  }

  eligibility(patientId: string, onDate: string) {
    return this.repo.checkEligibility(patientId, onDate);
  }

  authorize(input: { coverageId: string; encounterId: string; approvedAmount: number; status: 'approved' | 'denied' }) {
    return this.repo.authorize(input);
  }

  private async moveClaim(
    id: string,
    action: 'submit' | 'acknowledge' | 'pay' | 'deny' | 'appeal',
    opts: { denialReason?: string; correlationId?: string } = {},
  ) {
    const current = await this.repo.findClaim(id);
    if (!current) {
      throw new NotFoundException({ code: 'CLAIM_NOT_FOUND', message: 'Claim not found' });
    }
    let status: ClaimStatus;
    try {
      status = transitionClaim(current.status, action);
    } catch {
      throw new UnprocessableEntityException({
        code: 'CLAIM_TRANSITION',
        message: `Illegal transition: ${current.status} -> ${action}`,
      });
    }
    if (action === 'deny' && !opts.denialReason) {
      throw new BadRequestException({ code: 'DENIAL_REASON_REQUIRED', message: 'Denial requires a reason' });
    }
    await this.repo.setClaimStatus(id, status, opts.denialReason);
    await this.outbox.publish({
      aggregateType: 'claim',
      aggregateId: id,
      type: `claim.${status}`,
      producer: 'revenue',
      correlationId: opts.correlationId,
      payload: { id, status },
    });
    return { id, status };
  }

  fileClaim(invoiceId: string, payer: string, opts: { correlationId?: string } = {}) {
    return this.repo.fileClaim(invoiceId, payer).then(async (claim) => {
      await this.outbox.publish({
        aggregateType: 'claim',
        aggregateId: claim.id,
        type: 'claim.drafted',
        producer: 'revenue',
        correlationId: opts.correlationId,
        payload: { id: claim.id },
      });
      return claim;
    });
  }

  submitClaim(id: string, opts: { correlationId?: string } = {}) {
    return this.moveClaim(id, 'submit', opts);
  }

  acknowledgeClaim(id: string, opts: { correlationId?: string } = {}) {
    return this.moveClaim(id, 'acknowledge', opts);
  }

  payClaim(id: string, opts: { correlationId?: string } = {}) {
    return this.moveClaim(id, 'pay', opts);
  }

  denyClaim(id: string, opts: { denialReason: string; correlationId?: string }) {
    return this.moveClaim(id, 'deny', opts);
  }

  appealClaim(id: string, opts: { correlationId?: string } = {}) {
    return this.moveClaim(id, 'appeal', opts);
  }

  /**
   * Split a charge across responsible parties (CR-001 Phase 1b, ADR-007).
   * Invariant enforced before any write: shares sum to the charge total at 100%.
   * Re-allocation replaces prior shares atomically (history: prior outbox facts stand).
   */
  async allocate(
    chargeId: string,
    shares: AllocationShare[],
    opts: { correlationId?: string } = {},
  ) {
    const charge = await this.repo.findCharge(chargeId);
    if (!charge) {
      throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    }
    const total = charge.quantity * charge.unitPrice;
    try {
      checkAllocation(total, shares);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'ALLOCATION_INVALID';
      throw new UnprocessableEntityException({
        code,
        message: `Allocation must sum to charge total ${total} at 100%`,
      });
    }
    await this.repo.allocate(chargeId, shares);
    await this.outbox.publish({
      aggregateType: 'charge',
      aggregateId: chargeId,
      type: 'charge.allocated',
      producer: 'revenue',
      correlationId: opts.correlationId,
      payload: { id: chargeId, parties: shares.length },
    });
    return { id: chargeId, parties: shares.length };
  }

  outstandingByParty(invoiceId: string) {
    return this.repo.outstandingByParty(invoiceId);
  }

  /** Assemble claim lines from an invoice's charges (amounts frozen at assembly). */
  async assembleClaimLines(claimId: string, invoiceId: string, opts: { correlationId?: string } = {}) {
    const chargeIds = await this.repo.invoiceChargeIds(invoiceId);
    for (const chargeId of chargeIds) {
      const charge = await this.repo.findCharge(chargeId);
      if (charge) {
        await this.repo.addClaimLine(claimId, chargeId, charge.quantity * charge.unitPrice);
      }
    }
    await this.outbox.publish({
      aggregateType: 'claim',
      aggregateId: claimId,
      type: 'claim.lines_assembled',
      producer: 'revenue',
      correlationId: opts.correlationId,
      payload: { id: claimId, lines: chargeIds.length },
    });
    return { id: claimId, lines: chargeIds.length };
  }

  /** Every send (incl. resubmission) is a new version; payer claim ID recorded. */
  async submitVersion(claimId: string, opts: { payerClaimId?: string; correlationId?: string } = {}) {
    const found = await this.repo.findClaim(claimId);
    if (!found) {
      throw new NotFoundException({ code: 'CLAIM_NOT_FOUND', message: 'Claim not found' });
    }
    const sub = await this.repo.submitClaimVersion(claimId, opts.payerClaimId);
    await this.outbox.publish({
      aggregateType: 'claim',
      aggregateId: claimId,
      type: 'claim.submitted_version',
      producer: 'revenue',
      correlationId: opts.correlationId,
      payload: { id: claimId, version: sub.version },
    });
    return sub;
  }

  claimVersions(claimId: string) {
    return this.repo.claimVersions(claimId);
  }

  defineRule(input: {
    eventType: string;
    serviceCode?: string;
    codeField?: string;
    quantity?: number;
    correlationId?: string;
  }) {
    return this.repo
      .defineRule({
        eventType: input.eventType,
        ...(input.serviceCode ? { serviceCode: input.serviceCode } : {}),
        ...(input.codeField ? { codeField: input.codeField } : {}),
        quantity: input.quantity ?? 1,
      })
      .then(async (rule) => {
        await this.outbox.publish({
          aggregateType: 'billing_rule',
          aggregateId: rule.id,
          type: 'billing.rule_defined',
          producer: 'revenue',
          correlationId: input.correlationId,
          payload: { id: rule.id, eventType: input.eventType },
        });
        return rule;
      });
  }

  activeRules() {
    return this.repo.activeRules();
  }
}
