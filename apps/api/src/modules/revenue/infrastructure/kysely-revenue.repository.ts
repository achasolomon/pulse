import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ClaimStatus,
  InvoiceStatus,
  RevenueRepository,
} from '../domain/revenue.repository.js';

@Injectable()
export class KyselyRevenueRepository implements RevenueRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async defineService(input: { code: string; name: string; defaultPrice: number }) {
    const r = await this.db
      .insertInto('rev.service')
      .values({ code: input.code, name: input.name, default_price: input.defaultPrice })
      .onConflict((oc) => oc.column('code').doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (r) return { id: r.id };
    const existing = await this.db
      .selectFrom('rev.service')
      .select(['id'])
      .where('code', '=', input.code)
      .executeTakeFirstOrThrow();
    return { id: existing.id };
  }

  async findService(code: string) {
    const r = await this.db
      .selectFrom('rev.service')
      .select(['id', 'default_price'])
      .where('code', '=', code)
      .where('active', '=', true)
      .executeTakeFirst();
    return r ? { id: r.id, defaultPrice: Number(r.default_price) } : undefined;
  }

  async captureCharge(input: {
    patientId: string;
    encounterId?: string;
    serviceCode: string;
    quantity: number;
    unitPrice: number;
    sourceEventId?: string;
  }) {
    const r = await this.db
      .insertInto('rev.charge')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId ?? null,
        service_code: input.serviceCode,
        quantity: input.quantity,
        unit_price: input.unitPrice,
        source_event_id: input.sourceEventId ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findCharge(id: string) {
    const r = await this.db
      .selectFrom('rev.charge')
      .select(['quantity', 'unit_price'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { quantity: Number(r.quantity), unitPrice: Number(r.unit_price) } : undefined;
  }

  async findChargeBySourceEvent(eventId: string) {
    const r = await this.db
      .selectFrom('rev.charge')
      .select(['id'])
      .where('source_event_id', '=', eventId)
      .executeTakeFirst();
    return r ? { id: r.id } : undefined;
  }

  async cancelCharge(id: string, reason: string): Promise<void> {
    await this.db
      .updateTable('rev.charge')
      .set({ status: 'cancelled', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
  }

  async createInvoice(patientId: string) {
    const r = await this.db
      .insertInto('rev.invoice')
      .values({ patient_id: patientId })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async addLine(invoiceId: string, chargeId: string, amount: number): Promise<void> {
    await this.db
      .insertInto('rev.invoice_line')
      .values({ invoice_id: invoiceId, charge_id: chargeId, amount })
      .execute();
    await this.db
      .updateTable('rev.charge')
      .set({ status: 'billed' })
      .where('id', '=', chargeId)
      .execute();
  }

  async setInvoiceStatus(id: string, status: InvoiceStatus, voidReason?: string): Promise<void> {
    await this.db
      .updateTable('rev.invoice')
      .set({ status, ...(voidReason ? { void_reason: voidReason } : {}) })
      .where('id', '=', id)
      .execute();
  }

  async invoiceTotals(invoiceId: string) {
    const rows = await this.db
      .selectFrom('rev.invoice_line')
      .select(['amount'])
      .where('invoice_id', '=', invoiceId)
      .execute();
    return { lines: rows.map((r) => ({ amount: Number(r.amount) })) };
  }

  async invoiceChargeIds(invoiceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('rev.invoice_line')
      .select(['charge_id'])
      .where('invoice_id', '=', invoiceId)
      .execute();
    return rows.map((r) => r.charge_id);
  }

  async recordPayment(invoiceId: string, amount: number, method: string) {
    const r = await this.db
      .insertInto('rev.payment')
      .values({ invoice_id: invoiceId, amount, method })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async paymentsFor(invoiceId: string) {
    const rows = await this.db
      .selectFrom('rev.payment')
      .select(['amount'])
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'completed')
      .execute();
    return rows.map((r) => ({ amount: Number(r.amount) }));
  }

  async recordAdjustment(
    invoiceId: string,
    amount: number,
    kind: 'refund' | 'write-off' | 'correction',
    reason: string,
  ) {
    const r = await this.db
      .insertInto('rev.adjustment')
      .values({ invoice_id: invoiceId, amount, kind, reason })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async adjustmentsFor(invoiceId: string) {
    const rows = await this.db
      .selectFrom('rev.adjustment')
      .select(['kind', 'amount'])
      .where('invoice_id', '=', invoiceId)
      .execute();
    return rows.map((r) => ({ kind: r.kind, amount: Number(r.amount) }));
  }

  async addCoverage(input: {
    patientId: string;
    payer: string;
    plan: string;
    memberId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  }) {
    const r = await this.db
      .insertInto('rev.coverage')
      .values({
        patient_id: input.patientId,
        payer: input.payer,
        plan: input.plan,
        member_id: input.memberId,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findCoverage(id: string) {
    const r = await this.db
      .selectFrom('rev.coverage')
      .select(['id', 'patient_id', 'payer', 'plan', 'member_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      patientId: r.patient_id,
      payer: r.payer,
      plan: r.plan,
      memberId: r.member_id,
    };
  }

  async checkEligibility(patientId: string, onDate: string) {
    const r = await this.db
      .selectFrom('rev.coverage')
      .select(['payer', 'plan'])
      .where('patient_id', '=', patientId)
      .where('effective_from', '<=', onDate)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', onDate)]),
      )
      .orderBy('effective_from', 'desc')
      .executeTakeFirst();
    return r ? { payer: r.payer, plan: r.plan } : undefined;
  }

  async authorize(input: {
    coverageId: string;
    encounterId: string;
    approvedAmount: number;
    status: 'approved' | 'denied';
  }) {
    const r = await this.db
      .insertInto('rev.authorization')
      .values({
        coverage_id: input.coverageId,
        encounter_id: input.encounterId,
        approved_amount: input.approvedAmount,
        status: input.status,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async fileClaim(invoiceId: string, payer: string) {
    const r = await this.db
      .insertInto('rev.claim')
      .values({ invoice_id: invoiceId, payer })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findClaim(id: string) {
    const r = await this.db
      .selectFrom('rev.claim')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as ClaimStatus } : undefined;
  }

  async setClaimStatus(id: string, status: ClaimStatus, denialReason?: string): Promise<void> {
    await this.db
      .updateTable('rev.claim')
      .set({ status, ...(denialReason ? { denial_reason: denialReason } : {}) })
      .where('id', '=', id)
      .execute();
  }

  async allocate(
    chargeId: string,
    shares: { partyType: string; partyRef: string; sharePct: number; amount: number; tariffId?: string }[],
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('rev.allocation').where('charge_id', '=', chargeId).execute();
      for (const s of shares) {
        await trx
          .insertInto('rev.allocation')
          .values({
            charge_id: chargeId,
            party_type: s.partyType,
            party_ref: s.partyRef,
            share_pct: s.sharePct,
            amount: s.amount,
            tariff_id: s.tariffId ?? null,
          })
          .execute();
      }
    });
  }

  async allocationsForCharge(chargeId: string) {
    const rows = await this.db
      .selectFrom('rev.allocation')
      .select(['party_type', 'party_ref', 'share_pct', 'amount', 'tariff_id'])
      .where('charge_id', '=', chargeId)
      .execute();
    return rows.map((r) => ({
      partyType: r.party_type as 'patient' | 'payer' | 'guarantor',
      partyRef: r.party_ref,
      sharePct: Number(r.share_pct),
      amount: Number(r.amount),
      ...(r.tariff_id ? { tariffId: r.tariff_id } : {}),
    }));
  }

  async outstandingByParty(invoiceId: string) {
    // Per-party outstanding = allocated amounts on this invoice's charges
    // minus payments attributed proportionally is Phase 2; Phase 1 reports
    // allocated totals per party alongside the invoice balance.
    const rows = await this.db
      .selectFrom('rev.invoice_line as l')
      .innerJoin('rev.allocation as a', 'a.charge_id', 'l.charge_id')
      .select(['a.party_type', 'a.party_ref'])
      .select((eb) => eb.fn.sum<number>('a.amount').as('allocated'))
      .where('l.invoice_id', '=', invoiceId)
      .groupBy(['a.party_type', 'a.party_ref'])
      .execute();
    return rows.map((r) => ({
      partyType: r.party_type,
      partyRef: r.party_ref,
      outstanding: Number(r.allocated),
    }));
  }

  async addClaimLine(claimId: string, chargeId: string, amount: number): Promise<void> {
    await this.db
      .insertInto('rev.claim_line')
      .values({ claim_id: claimId, charge_id: chargeId, amount })
      .execute();
  }

  async submitClaimVersion(claimId: string, payerClaimId?: string) {
    const prev = await this.db
      .selectFrom('rev.claim_submission')
      .select(['version'])
      .where('claim_id', '=', claimId)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    const version = (prev?.version ?? 0) + 1;
    await this.db
      .insertInto('rev.claim_submission')
      .values({ claim_id: claimId, version, payer_claim_id: payerClaimId ?? null })
      .execute();
    return { version };
  }

  async claimVersions(claimId: string) {
    const rows = await this.db
      .selectFrom('rev.claim_submission')
      .select(['version', 'payer_claim_id'])
      .where('claim_id', '=', claimId)
      .orderBy('version')
      .execute();
    return rows.map((r) => ({
      version: r.version,
      ...(r.payer_claim_id ? { payerClaimId: r.payer_claim_id } : {}),
    }));
  }

  async invoicesFor(patientId: string, limit: number) {
    const rows = await this.db
      .selectFrom('rev.invoice')
      .select(['id', 'status'])
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status }));
  }

  async defineRule(input: {
    eventType: string;
    serviceCode?: string;
    codeField?: string;
    quantity: number;
  }) {
    const r = await this.db
      .insertInto('rev.billing_rule')
      .values({
        event_type: input.eventType,
        service_code: input.serviceCode ?? null,
        code_field: input.codeField ?? null,
        quantity: input.quantity,
      })
      .onConflict((oc) =>
        oc.columns(['event_type', 'service_code']).doUpdateSet({
          code_field: input.codeField ?? null,
          quantity: input.quantity,
          active: true,
        }),
      )
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async activeRules() {
    const rows = await this.db
      .selectFrom('rev.billing_rule')
      .select(['event_type', 'service_code', 'code_field', 'quantity', 'active'])
      .where('active', '=', true)
      .execute();
    return rows.map((r) => ({
      eventType: r.event_type,
      ...(r.service_code ? { serviceCode: r.service_code } : {}),
      ...(r.code_field ? { codeField: r.code_field } : {}),
      quantity: Number(r.quantity),
      active: r.active,
    }));
  }
}
