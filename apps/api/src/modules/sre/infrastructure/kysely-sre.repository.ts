import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  Alert,
  AlertRule,
  AlertState,
  BackupKind,
  BackupRun,
  BackupStatus,
  SreRepository,
} from '../domain/sre.repository.js';

function iso(v: Date): string {
  return v.toISOString();
}

function toRule(r: {
  id: string;
  name: string;
  description: string;
  metric: string;
  comparator: string;
  threshold: number;
  window_minutes: number;
  severity: string;
  owner: string;
  runbook: string;
  enabled: boolean;
}): AlertRule {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    metric: r.metric as AlertRule['metric'],
    comparator: r.comparator as AlertRule['comparator'],
    threshold: Number(r.threshold),
    windowMinutes: r.window_minutes,
    severity: r.severity as AlertRule['severity'],
    owner: r.owner,
    runbook: r.runbook,
    enabled: r.enabled,
  };
}

function toAlert(r: {
  id: string;
  rule_id: string;
  state: string;
  value: number;
  started_at: Date;
  resolved_at: Date | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  detail: Record<string, unknown>;
}): Alert {
  return {
    id: r.id,
    ruleId: r.rule_id,
    state: r.state as AlertState,
    value: Number(r.value),
    startedAt: iso(r.started_at),
    ...(r.resolved_at ? { resolvedAt: iso(r.resolved_at) } : {}),
    ...(r.acknowledged_at ? { acknowledgedAt: iso(r.acknowledged_at) } : {}),
    ...(r.acknowledged_by ? { acknowledgedBy: r.acknowledged_by } : {}),
    detail:
      typeof r.detail === 'string'
        ? (JSON.parse(r.detail) as Record<string, unknown>)
        : (r.detail as Record<string, unknown>),
  };
}

function toBackup(r: {
  id: string;
  kind: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  rpo_target_minutes: number | null;
  rto_target_seconds: number | null;
  evidence: Record<string, unknown>;
}): BackupRun {
  return {
    id: r.id,
    kind: r.kind as BackupKind,
    status: r.status as BackupStatus,
    startedAt: iso(r.started_at),
    ...(r.finished_at ? { finishedAt: iso(r.finished_at) } : {}),
    ...(r.rpo_target_minutes !== null ? { rpoTargetMinutes: r.rpo_target_minutes } : {}),
    ...(r.rto_target_seconds !== null ? { rtoTargetSeconds: r.rto_target_seconds } : {}),
    evidence:
      typeof r.evidence === 'string'
        ? (JSON.parse(r.evidence) as Record<string, unknown>)
        : (r.evidence as Record<string, unknown>),
  };
}

@Injectable()
export class KyselySreRepository implements SreRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async listRules(enabledOnly = false): Promise<AlertRule[]> {
    let q = this.db.selectFrom('ops.alert_rule').selectAll().orderBy('name');
    if (enabledOnly) q = q.where('enabled', '=', true);
    const rows = await q.execute();
    return rows.map(toRule);
  }

  async findFiring(ruleId: string): Promise<Alert | undefined> {
    const r = await this.db
      .selectFrom('ops.alert')
      .selectAll()
      .where('rule_id', '=', ruleId)
      .where('state', '=', 'firing')
      .orderBy('started_at')
      .executeTakeFirst();
    return r ? toAlert(r) : undefined;
  }

  async openAlert(input: {
    ruleId: string;
    value: number;
    detail: Record<string, unknown>;
  }): Promise<Alert> {
    const r = await this.db
      .insertInto('ops.alert')
      .values({ rule_id: input.ruleId, state: 'firing', value: input.value, detail: input.detail })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAlert(r);
  }

  async updateAlertValue(id: string, value: number): Promise<void> {
    await this.db.updateTable('ops.alert').set({ value }).where('id', '=', id).execute();
  }

  async resolveAlert(id: string, value: number): Promise<void> {
    await this.db
      .updateTable('ops.alert')
      .set({ state: 'resolved', value, resolved_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async listAlerts(filter?: { state?: AlertState; limit?: number }): Promise<Alert[]> {
    let q = this.db.selectFrom('ops.alert').selectAll().orderBy('started_at');
    if (filter?.state) q = q.where('state', '=', filter.state);
    if (filter?.limit) q = q.limit(filter.limit);
    const rows = await q.execute();
    return rows.map(toAlert);
  }

  async createBackupRun(input: {
    kind: BackupKind;
    rpoTargetMinutes?: number;
    rtoTargetSeconds?: number;
  }): Promise<BackupRun> {
    const r = await this.db
      .insertInto('ops.backup_run')
      .values({
        kind: input.kind,
        status: 'running',
        ...(input.rpoTargetMinutes !== undefined
          ? { rpo_target_minutes: input.rpoTargetMinutes }
          : {}),
        ...(input.rtoTargetSeconds !== undefined
          ? { rto_target_seconds: input.rtoTargetSeconds }
          : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toBackup(r);
  }

  async completeBackupRun(
    id: string,
    input: { status: 'succeeded' | 'failed'; evidence: Record<string, unknown>; finishedAt: Date },
  ): Promise<void> {
    await this.db
      .updateTable('ops.backup_run')
      .set({ status: input.status, finished_at: input.finishedAt, evidence: input.evidence })
      .where('id', '=', id)
      .execute();
  }

  async lastSucceededFullBackup(): Promise<BackupRun | undefined> {
    const r = await this.db
      .selectFrom('ops.backup_run')
      .selectAll()
      .where('kind', '=', 'full')
      .where('status', '=', 'succeeded')
      .orderBy('finished_at', 'desc')
      .executeTakeFirst();
    return r ? toBackup(r) : undefined;
  }

  async listBackupRuns(filter?: { kind?: BackupKind; limit?: number }): Promise<BackupRun[]> {
    let q = this.db.selectFrom('ops.backup_run').selectAll().orderBy('started_at');
    if (filter?.kind) q = q.where('kind', '=', filter.kind);
    if (filter?.limit) q = q.limit(filter.limit);
    const rows = await q.execute();
    return rows.map(toBackup);
  }
}
