import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  InsuranceRepository,
  Payer,
} from '../domain/insurance.repository.js';

@Injectable()
export class KyselyInsuranceRepository implements InsuranceRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async definePayer(input: { code: string; name: string }): Promise<Payer> {
    const r = await this.db
      .insertInto('ins.payer')
      .values({ code: input.code, name: input.name })
      .onConflict((oc) => oc.column('code').doNothing())
      .returning(['id', 'code', 'name', 'active'])
      .executeTakeFirst();
    if (r) return { id: r.id, code: r.code, name: r.name, active: r.active };
    const existing = await this.db
      .selectFrom('ins.payer')
      .select(['id', 'code', 'name', 'active'])
      .where('code', '=', input.code)
      .executeTakeFirstOrThrow();
    return { id: existing.id, code: existing.code, name: existing.name, active: existing.active };
  }

  async signContract(input: {
    facilityId: string;
    payerId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }) {
    const r = await this.db
      .insertInto('ins.facility_contract')
      .values({
        facility_id: input.facilityId,
        payer_id: input.payerId,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async publishSchedule(contractId: string, effectiveFrom: string) {
    const prev = await this.db
      .selectFrom('ins.tariff_schedule')
      .select(['version'])
      .where('contract_id', '=', contractId)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    const r = await this.db
      .insertInto('ins.tariff_schedule')
      .values({ contract_id: contractId, version: (prev?.version ?? 0) + 1, effective_from: effectiveFrom })
      .returning(['id', 'version'])
      .executeTakeFirstOrThrow();
    return { id: r.id, version: r.version };
  }

  async setTariffLine(scheduleId: string, serviceCode: string, price: number) {
    const r = await this.db
      .insertInto('ins.tariff_line')
      .values({ schedule_id: scheduleId, service_code: serviceCode, price })
      .onConflict((oc) => oc.columns(['schedule_id', 'service_code']).doUpdateSet({ price }))
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async candidateLines(input: { facilityId: string; payerId: string; onDate: string }) {
    const rows = await this.db
      .selectFrom('ins.facility_contract as c')
      .innerJoin('ins.tariff_schedule as s', 's.contract_id', 'c.id')
      .innerJoin('ins.tariff_line as l', 'l.schedule_id', 's.id')
      .select(['l.id', 'l.service_code', 'l.price', 's.version as schedule_version'])
      .where('c.facility_id', '=', input.facilityId)
      .where('c.payer_id', '=', input.payerId)
      .where('c.status', '=', 'active')
      .where('c.effective_from', '<=', input.onDate)
      .where((eb) =>
        eb.or([eb('c.effective_to', 'is', null), eb('c.effective_to', '>=', input.onDate)]),
      )
      .where('s.effective_from', '<=', input.onDate)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      serviceCode: r.service_code,
      price: Number(r.price),
      scheduleVersion: r.schedule_version,
    }));
  }

  async recordEligibility(input: {
    coverageId: string;
    encounterId?: string;
    method: 'manual' | 'payer-query';
    evidence: string;
    verifiedBy?: string;
    result: 'eligible' | 'ineligible' | 'partial';
  }) {
    const r = await this.db
      .insertInto('ins.eligibility_check')
      .values({
        coverage_id: input.coverageId,
        encounter_id: input.encounterId ?? null,
        method: input.method,
        evidence: input.evidence,
        verified_by: input.verifiedBy ?? null,
        result: input.result,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async openPreauth(input: { coverageId: string; encounterId: string; lines: unknown[] }) {
    const r = await this.db
      .insertInto('ins.preauth_case')
      .values({
        coverage_id: input.coverageId,
        encounter_id: input.encounterId,
        lines: JSON.stringify(input.lines),
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as 'requested' };
  }

  async findPreauth(id: string) {
    const r = await this.db
      .selectFrom('ins.preauth_case')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as 'requested' | 'docs-requested' | 'approved' | 'denied' | 'expired' | 'cancelled' } : undefined;
  }

  async setPreauthStatus(
    id: string,
    status: 'requested' | 'docs-requested' | 'approved' | 'denied' | 'expired' | 'cancelled',
    extra?: { decisionNote?: string; expiresOn?: string },
  ): Promise<void> {
    await this.db
      .updateTable('ins.preauth_case')
      .set({
        status,
        ...(extra?.decisionNote ? { decision_note: extra.decisionNote } : {}),
        ...(extra?.expiresOn ? { expires_on: extra.expiresOn } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async defineBenefit(input: {
    payerCode: string;
    plan: string;
    deductibleAnnual: number;
    copayAmount: number;
    coinsurancePct: number;
    effectiveFrom: string;
  }) {
    const r = await this.db
      .insertInto('ins.plan_benefit')
      .values({
        payer_code: input.payerCode,
        plan: input.plan,
        deductible_annual: input.deductibleAnnual,
        copay_amount: input.copayAmount,
        coinsurance_pct: input.coinsurancePct,
        effective_from: input.effectiveFrom,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findBenefit(payerCode: string, plan: string, onDate: string) {
    const r = await this.db
      .selectFrom('ins.plan_benefit')
      .select(['deductible_annual', 'copay_amount', 'coinsurance_pct'])
      .where('payer_code', '=', payerCode)
      .where('plan', '=', plan)
      .where('effective_from', '<=', onDate)
      .orderBy('effective_from', 'desc')
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      deductibleAnnual: Number(r.deductible_annual),
      copayAmount: Number(r.copay_amount),
      coinsurancePct: Number(r.coinsurance_pct),
    };
  }

  async deductibleUsed(payerCode: string, plan: string, memberId: string, year: number): Promise<number> {
    const r = await this.db
      .selectFrom('ins.deductible_use')
      .select((eb) => eb.fn.sum<number>('amount').as('total'))
      .where('payer_code', '=', payerCode)
      .where('plan', '=', plan)
      .where('member_id', '=', memberId)
      .where('year', '=', year)
      .executeTakeFirst();
    return Number(r?.total ?? 0);
  }

  async postDeductibleUse(input: {
    payerCode: string;
    plan: string;
    memberId: string;
    year: number;
    chargeId: string;
    amount: number;
  }): Promise<void> {
    await this.db
      .insertInto('ins.deductible_use')
      .values({
        payer_code: input.payerCode,
        plan: input.plan,
        member_id: input.memberId,
        year: input.year,
        charge_id: input.chargeId,
        amount: input.amount,
      })
      .onConflict((oc) => oc.column('charge_id').doNothing())
      .execute();
  }
}
