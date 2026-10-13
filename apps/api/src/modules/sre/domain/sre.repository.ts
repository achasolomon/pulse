/** SRE alerts + backup evidence domain (OPS-001 sections 43-44, 62-68). */

export type AlertSeverity = 'P1' | 'P2' | 'P3' | 'P4';
export type AlertMetric = 'error_rate' | 'backup_staleness_minutes';
export type AlertState = 'firing' | 'resolved';
export type BackupKind = 'full' | 'wal' | 'restore_drill';
export type BackupStatus = 'running' | 'succeeded' | 'failed';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: AlertMetric;
  comparator: '>' | '>=';
  threshold: number;
  windowMinutes: number;
  severity: AlertSeverity;
  owner: string;
  runbook: string;
  enabled: boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  state: AlertState;
  value: number;
  startedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  detail: Record<string, unknown>;
}

export interface BackupRun {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  startedAt: string;
  finishedAt?: string;
  rpoTargetMinutes?: number;
  rtoTargetSeconds?: number;
  evidence: Record<string, unknown>;
}

export const SRE_REPOSITORY = 'SRE_REPOSITORY';

export interface SreRepository {
  listRules(enabledOnly?: boolean): Promise<AlertRule[]>;
  findFiring(ruleId: string): Promise<Alert | undefined>;
  openAlert(input: {
    ruleId: string;
    value: number;
    detail: Record<string, unknown>;
  }): Promise<Alert>;
  updateAlertValue(id: string, value: number): Promise<void>;
  resolveAlert(id: string, value: number): Promise<void>;
  listAlerts(filter?: { state?: AlertState; limit?: number }): Promise<Alert[]>;
  createBackupRun(input: {
    kind: BackupKind;
    rpoTargetMinutes?: number;
    rtoTargetSeconds?: number;
  }): Promise<BackupRun>;
  completeBackupRun(
    id: string,
    input: { status: 'succeeded' | 'failed'; evidence: Record<string, unknown>; finishedAt: Date },
  ): Promise<void>;
  lastSucceededFullBackup(): Promise<BackupRun | undefined>;
  listBackupRuns(filter?: { kind?: BackupKind; limit?: number }): Promise<BackupRun[]>;
}

/** Threshold comparison (OPS-001 alert philosophy: value breaches rule). */
export function breaches(value: number, comparator: '>' | '>=', threshold: number): boolean {
  return comparator === '>' ? value > threshold : value >= threshold;
}

/** Minutes since the last successful full backup (Infinity when none). */
export function backupStalenessMinutes(
  last: { finishedAt?: string } | undefined,
  now: Date = new Date(),
): number {
  if (!last?.finishedAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(last.finishedAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 60_000);
}

export function errorRate(serverErrors: number, totalRequests: number): number {
  return totalRequests === 0 ? 0 : serverErrors / totalRequests;
}
