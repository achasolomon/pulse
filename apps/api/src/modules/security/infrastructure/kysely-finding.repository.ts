import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Finding,
  FindingRepository,
  FindingSeverity,
  FindingStatus,
} from '../domain/finding.repository.js';

function toDate(v: Date): string {
  return v.toISOString();
}

function toFinding(r: {
  id: string;
  title: string;
  severity: string;
  status: string;
  vector: string | null;
  component: string;
  evidence: string | null;
  owner: string | null;
  remediation: string | null;
  found_at: Date;
  triaged_at: Date | null;
  triaged_by: string | null;
  due_at: Date | null;
}): Finding {
  return {
    id: r.id,
    title: r.title,
    severity: r.severity as FindingSeverity,
    status: r.status as FindingStatus,
    ...(r.vector ? { vector: r.vector } : {}),
    component: r.component,
    ...(r.evidence ? { evidence: r.evidence } : {}),
    ...(r.owner ? { owner: r.owner } : {}),
    ...(r.remediation ? { remediation: r.remediation } : {}),
    foundAt: toDate(r.found_at),
    ...(r.triaged_at ? { triagedAt: toDate(r.triaged_at) } : {}),
    ...(r.triaged_by ? { triagedBy: r.triaged_by } : {}),
    ...(r.due_at ? { dueAt: toDate(r.due_at) } : {}),
  };
}

@Injectable()
export class KyselyFindingRepository implements FindingRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: {
    title: string;
    severity: FindingSeverity;
    component: string;
    vector?: string;
    evidence?: string;
    owner?: string;
    remediation?: string;
    dueAt?: string;
  }): Promise<Finding> {
    const row = await this.db
      .insertInto('security.finding')
      .values({
        title: input.title,
        severity: input.severity,
        component: input.component,
        ...(input.vector ? { vector: input.vector } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
        ...(input.owner ? { owner: input.owner } : {}),
        ...(input.remediation ? { remediation: input.remediation } : {}),
        ...(input.dueAt ? { due_at: new Date(input.dueAt) } : {}),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const found = await this.findById(row.id);
    if (!found) throw new Error('FINDING_CREATE_FAILED');
    return found;
  }

  async findById(id: string): Promise<Finding | undefined> {
    const r = await this.db
      .selectFrom('security.finding')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? toFinding(r) : undefined;
  }

  async list(filter?: { status?: FindingStatus; severity?: FindingSeverity }): Promise<Finding[]> {
    let q = this.db.selectFrom('security.finding').selectAll().orderBy('found_at');
    if (filter?.status) q = q.where('status', '=', filter.status);
    if (filter?.severity) q = q.where('severity', '=', filter.severity);
    const rows = await q.execute();
    return rows.map(toFinding);
  }

  async transition(
    id: string,
    status: FindingStatus,
    input: { owner?: string; remediation?: string; triagedBy?: string; at: Date },
  ): Promise<void> {
    await this.db
      .updateTable('security.finding')
      .set({
        status,
        triaged_at: input.at,
        ...(input.triagedBy ? { triaged_by: input.triagedBy } : {}),
        ...(input.owner ? { owner: input.owner } : {}),
        ...(input.remediation ? { remediation: input.remediation } : {}),
      })
      .where('id', '=', id)
      .execute();
  }
}
