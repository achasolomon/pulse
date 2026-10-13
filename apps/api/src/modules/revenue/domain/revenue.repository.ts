/** Revenue domain (REV-001, EPIC-14, DB-001 sections 37-40). Money follows care; never rewrites it. */

export type InvoiceStatus = 'draft' | 'final' | 'paid' | 'partial' | 'void';
export type ClaimStatus = 'draft' | 'submitted' | 'acknowledged' | 'paid' | 'denied' | 'appealed';

/** Pure invoice balance: total - payments + nothing else (refunds tracked separately, still owed math stays explicit). */
export function invoiceBalance(input: {
  lines: { amount: number }[];
  payments: { amount: number }[];
  adjustments: { kind: string; amount: number }[];
}): { total: number; paid: number; outstanding: number } {
  const total = input.lines.reduce((s, l) => s + Number(l.amount), 0);
  const paid = input.payments.reduce((s, p) => s + Number(p.amount), 0);
  const refunded = input.adjustments
    .filter((a) => a.kind === 'refund')
    .reduce((s, a) => s + Number(a.amount), 0);
  return { total, paid, outstanding: total - paid + refunded };
}

/** Pure claim machine. Throws Error('CLAIM_TRANSITION:...') on illegal moves. */
export function transitionClaim(
  from: ClaimStatus,
  action: 'submit' | 'acknowledge' | 'pay' | 'deny' | 'appeal',
): ClaimStatus {
  const next: Record<string, ClaimStatus> = {
    'draft:submit': 'submitted',
    'submitted:acknowledge': 'acknowledged',
    'acknowledged:pay': 'paid',
    'acknowledged:deny': 'denied',
    'submitted:deny': 'denied',
    'denied:appeal': 'appealed',
    'appealed:submit': 'submitted',
  };
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`CLAIM_TRANSITION:${from}->${action}`);
  return to;
}

export type AllocationParty = 'patient' | 'payer' | 'guarantor';

export interface AllocationShare {
  partyType: AllocationParty;
  partyRef: string;
  sharePct: number;
  amount: number;
  tariffId?: string;
}

/**
 * Pure allocation invariant (CR-001 §6): shares must sum exactly to the charge
 * total, percentages to 100. Throws Error('ALLOCATION_*') otherwise.
 */
export function checkAllocation(
  chargeTotal: number,
  shares: { sharePct: number; amount: number }[],
): void {
  if (shares.length === 0) throw new Error('ALLOCATION_EMPTY');
  const pct = shares.reduce((s, x) => s + Number(x.sharePct), 0);
  if (Math.abs(pct - 100) > 0.001) throw new Error('ALLOCATION_PCT');
  const sum = shares.reduce((s, x) => s + Number(x.amount), 0);
  if (Math.abs(sum - chargeTotal) > 0.005) throw new Error('ALLOCATION_SUM');
}

export interface BillingRule {
  eventType: string;
  serviceCode?: string;
  codeField?: string;
  quantity: number;
  active: boolean;
}

export const REVENUE_REPOSITORY = 'REVENUE_REPOSITORY';

export interface RevenueRepository {
  defineService(input: { code: string; name: string; defaultPrice: number }): Promise<{ id: string }>;
  findService(code: string): Promise<{ id: string; defaultPrice: number } | undefined>;
  captureCharge(input: {
    patientId: string;
    encounterId?: string;
    serviceCode: string;
    quantity: number;
    unitPrice: number;
    sourceEventId?: string;
  }): Promise<{ id: string }>;
  findCharge(id: string): Promise<{ quantity: number; unitPrice: number } | undefined>;
  findChargeBySourceEvent(eventId: string): Promise<{ id: string } | undefined>;
  cancelCharge(id: string, reason: string): Promise<void>;
  createInvoice(patientId: string): Promise<{ id: string }>;
  addLine(invoiceId: string, chargeId: string, amount: number): Promise<void>;
  setInvoiceStatus(id: string, status: InvoiceStatus, voidReason?: string): Promise<void>;
  invoiceTotals(invoiceId: string): Promise<{ lines: { amount: number }[] }>;
  invoiceChargeIds(invoiceId: string): Promise<string[]>;
  recordPayment(invoiceId: string, amount: number, method: string): Promise<{ id: string }>;
  paymentsFor(invoiceId: string): Promise<{ amount: number }[]>;
  recordAdjustment(invoiceId: string, amount: number, kind: 'refund' | 'write-off' | 'correction', reason: string): Promise<{ id: string }>;
  adjustmentsFor(invoiceId: string): Promise<{ kind: string; amount: number }[]>;
  addCoverage(input: {
    patientId: string;
    payer: string;
    plan: string;
    memberId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<{ id: string }>;
  findCoverage(id: string): Promise<
    { id: string; patientId: string; payer: string; plan: string; memberId: string } | undefined
  >;
  checkEligibility(patientId: string, onDate: string): Promise<{ payer: string; plan: string } | undefined>;
  authorize(input: { coverageId: string; encounterId: string; approvedAmount: number; status: 'approved' | 'denied' }): Promise<{ id: string }>;
  fileClaim(invoiceId: string, payer: string): Promise<{ id: string }>;
  findClaim(id: string): Promise<{ id: string; status: ClaimStatus } | undefined>;
  setClaimStatus(id: string, status: ClaimStatus, denialReason?: string): Promise<void>;
  allocate(chargeId: string, shares: AllocationShare[]): Promise<void>;
  allocationsForCharge(chargeId: string): Promise<AllocationShare[]>;
  outstandingByParty(invoiceId: string): Promise<{ partyType: string; partyRef: string; outstanding: number }[]>;
  addClaimLine(claimId: string, chargeId: string, amount: number): Promise<void>;
  submitClaimVersion(claimId: string, payerClaimId?: string): Promise<{ version: number }>;
  claimVersions(claimId: string): Promise<{ version: number; payerClaimId?: string }[]>;
  invoicesFor(patientId: string, limit: number): Promise<{ id: string; status: string }[]>;
  defineRule(input: {
    eventType: string;
    serviceCode?: string;
    codeField?: string;
    quantity: number;
  }): Promise<{ id: string }>;
  activeRules(): Promise<BillingRule[]>;
}
