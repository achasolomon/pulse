/** Insurance domain (CR-001, ADR-007, EPIC-14 follow-on). Owns ins.* ; revenue stays book of record. */

export interface Payer {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface TariffResolution {
  /** Resolved unit price, or undefined when no contract/tariff matches (caller falls back to default_price). */
  price?: number;
  /** Tariff line pinned at capture for dispute resolution, when matched. */
  tariffId?: string;
}

/**
 * Pure price selection (unit-tested): latest effective schedule version wins;
 * exact service match required — never fuzzy-matched, never silent.
 */
export function selectTariffLine(
  lines: { id: string; serviceCode: string; price: number; scheduleVersion: number }[],
  serviceCode: string,
): { id: string; price: number } | undefined {
  const matches = lines
    .filter((l) => l.serviceCode === serviceCode)
    .sort((a, b) => b.scheduleVersion - a.scheduleVersion);
  const best = matches[0];
  return best ? { id: best.id, price: best.price } : undefined;
}

export type PreauthStatus =
  | 'requested'
  | 'docs-requested'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled';

/** Pure preauth machine. Throws Error('PREAUTH_TRANSITION:...') on illegal moves. */
export function transitionPreauth(
  from: PreauthStatus,
  action: 'request-docs' | 'resubmit' | 'approve' | 'deny' | 'expire' | 'cancel',
): PreauthStatus {
  const next: Record<string, PreauthStatus> = {
    'requested:request-docs': 'docs-requested',
    'requested:approve': 'approved',
    'requested:deny': 'denied',
    'requested:cancel': 'cancelled',
    'docs-requested:resubmit': 'requested',
    'docs-requested:cancel': 'cancelled',
  };
  if (action === 'expire' && (from === 'requested' || from === 'docs-requested' || from === 'approved')) {
    return 'expired';
  }
  const to = next[`${from}:${action}`];
  if (!to) throw new Error(`PREAUTH_TRANSITION:${from}->${action}`);
  return to;
}

export const INSURANCE_REPOSITORY = 'INSURANCE_REPOSITORY';

export interface BenefitRules {
  deductibleAnnual: number;
  copayAmount: number;
  coinsurancePct: number;
}

export interface BenefitSplit {
  deductibleApplied: number;
  copayApplied: number;
  coinsuranceApplied: number;
  patientTotal: number;
  payerTotal: number;
}

/**
 * Pure benefit split (CR-001 Phase 2a). Order: deductible first, then flat
 * copay, then coinsurance on the remainder; payer takes the rest.
 * Invariants: patientTotal + payerTotal == gross; all parts >= 0; patient
 * never exceeds gross. Throws Error('BENEFIT_*') on bad inputs.
 */
export function computeSplit(
  gross: number,
  rules: BenefitRules,
  deductibleUsed: number,
): BenefitSplit {
  if (!(gross > 0)) throw new Error('BENEFIT_GROSS');
  if (rules.deductibleAnnual < 0 || rules.copayAmount < 0) throw new Error('BENEFIT_RULES');
  if (rules.coinsurancePct < 0 || rules.coinsurancePct > 100) throw new Error('BENEFIT_RULES');
  if (deductibleUsed < 0) throw new Error('BENEFIT_USED');
  const deductibleLeft = Math.max(0, rules.deductibleAnnual - deductibleUsed);
  const deductibleApplied = Math.min(deductibleLeft, gross);
  const afterDeductible = gross - deductibleApplied;
  const copayApplied = Math.min(rules.copayAmount, afterDeductible);
  const afterCopay = afterDeductible - copayApplied;
  const coinsuranceApplied = Math.min(afterCopay, (afterCopay * rules.coinsurancePct) / 100);
  const patientTotal = deductibleApplied + copayApplied + coinsuranceApplied;
  const payerTotal = gross - patientTotal;
  return { deductibleApplied, copayApplied, coinsuranceApplied, patientTotal, payerTotal };
}

export interface InsuranceRepository {
  definePayer(input: { code: string; name: string }): Promise<Payer>;
  signContract(input: {
    facilityId: string;
    payerId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }): Promise<{ id: string }>;
  publishSchedule(contractId: string, effectiveFrom: string): Promise<{ id: string; version: number }>;
  setTariffLine(scheduleId: string, serviceCode: string, price: number): Promise<{ id: string }>;
  /** All candidate lines for (facility, payer, date): caller filters by service. */
  candidateLines(input: {
    facilityId: string;
    payerId: string;
    onDate: string;
  }): Promise<{ id: string; serviceCode: string; price: number; scheduleVersion: number }[]>;
  recordEligibility(input: {
    coverageId: string;
    encounterId?: string;
    method: 'manual' | 'payer-query';
    evidence: string;
    verifiedBy?: string;
    result: 'eligible' | 'ineligible' | 'partial';
  }): Promise<{ id: string }>;
  openPreauth(input: {
    coverageId: string;
    encounterId: string;
    lines: unknown[];
  }): Promise<{ id: string; status: PreauthStatus }>;
  findPreauth(id: string): Promise<{ id: string; status: PreauthStatus } | undefined>;
  setPreauthStatus(
    id: string,
    status: PreauthStatus,
    extra?: { decisionNote?: string; expiresOn?: string },
  ): Promise<void>;
  defineBenefit(input: {
    payerCode: string;
    plan: string;
    deductibleAnnual: number;
    copayAmount: number;
    coinsurancePct: number;
    effectiveFrom: string;
  }): Promise<{ id: string }>;
  findBenefit(payerCode: string, plan: string, onDate: string): Promise<BenefitRules | undefined>;
  deductibleUsed(payerCode: string, plan: string, memberId: string, year: number): Promise<number>;
  postDeductibleUse(input: {
    payerCode: string;
    plan: string;
    memberId: string;
    year: number;
    chargeId: string;
    amount: number;
  }): Promise<void>;
}
