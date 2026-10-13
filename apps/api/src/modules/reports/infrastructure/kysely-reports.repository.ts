import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ClaimAgingRow,
  CensusRow,
  ReportsRepository,
  RevenueSummary,
} from '../domain/reports.repository.js';

@Injectable()
export class KyselyReportsRepository implements ReportsRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async census(facilityId: string): Promise<CensusRow[]> {
    const rows = await this.db
      .selectFrom('encounter.encounter')
      .select(['status', 'department_id'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('facility_id', '=', facilityId)
      .where('status', 'in', ['open', 'admitted'])
      .groupBy(['status', 'department_id'])
      .execute();
    return rows.map((r) => ({
      status: r.status,
      ...(r.department_id ? { departmentId: r.department_id } : {}),
      count: Number(r.count),
    }));
  }

  async revenue(facilityId: string, from: string, to: string): Promise<RevenueSummary> {
    // Charges booked at this facility's encounters in window; invoice/payment
    // totals patient-scoped (per-facility ledger split is Phase 2 reporting).
    const charges = await sql<{ total: number }>`
      SELECT COALESCE(SUM(c.quantity * c.unit_price), 0) AS total
      FROM rev.charge AS c
      JOIN encounter.encounter AS e ON e.id = c.encounter_id
      WHERE e.facility_id = ${facilityId}
        AND c.created_at >= ${from}::timestamptz
        AND c.created_at < ${to}::timestamptz
        AND c.status <> 'cancelled'`.execute(this.db);
    const invoiced = await sql<{ total: number }>`
      SELECT COALESCE(SUM(l.amount), 0) AS total
      FROM rev.invoice_line AS l
      JOIN rev.invoice AS i ON i.id = l.invoice_id
      JOIN rev.charge AS c ON c.id = l.charge_id
      JOIN encounter.encounter AS e ON e.id = c.encounter_id
      WHERE e.facility_id = ${facilityId}`.execute(this.db);
    const paid = await sql<{ total: number }>`
      SELECT COALESCE(SUM(p.amount), 0) AS total
      FROM rev.payment AS p
      JOIN rev.invoice AS i ON i.id = p.invoice_id
      JOIN rev.invoice_line AS l ON l.invoice_id = i.id
      JOIN rev.charge AS c ON c.id = l.charge_id
      JOIN encounter.encounter AS e ON e.id = c.encounter_id
      WHERE e.facility_id = ${facilityId}
        AND p.status = 'completed'`.execute(this.db);
    const ch = Number(charges.rows[0]?.total ?? 0);
    const inv = Number(invoiced.rows[0]?.total ?? 0);
    const pd = Number(paid.rows[0]?.total ?? 0);
    return { charges: ch, invoiced: inv, paid: pd, outstanding: inv - pd };
  }

  async claimAging(_facilityId: string): Promise<ClaimAgingRow[]> {
    const rows = await this.db
      .selectFrom('rev.claim')
      .select(['status'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy(['status'])
      .execute();
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }
}
