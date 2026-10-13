import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { backupStalenessMinutes } from '../domain/sre.repository.js';
import {
  SRE_REPOSITORY,
  type BackupKind,
  type SreRepository,
} from '../domain/sre.repository.js';

/**
 * Backup + restore-drill evidence register (OPS-001 62-68, F23.2/F23.3).
 * External schedulers (scripts/backup-dr-drill.mjs, cron) register runs and
 * complete them with measured evidence; staleness feeds the P2 alert rule.
 */
@Injectable()
export class BackupService {
  constructor(
    @Inject(SRE_REPOSITORY) private readonly repo: SreRepository,
    private readonly outbox: OutboxService,
  ) {}

  async register(input: {
    kind: BackupKind;
    rpoTargetMinutes?: number;
    rtoTargetSeconds?: number;
    correlationId?: string;
  }) {
    if (!['full', 'wal', 'restore_drill'].includes(input.kind)) {
      throw new BadRequestException({
        code: 'BACKUP_KIND_INVALID',
        message: 'kind must be full|wal|restore_drill',
      });
    }
    const run = await this.repo.createBackupRun({
      kind: input.kind,
      ...(input.rpoTargetMinutes !== undefined
        ? { rpoTargetMinutes: input.rpoTargetMinutes }
        : {}),
      ...(input.rtoTargetSeconds !== undefined
        ? { rtoTargetSeconds: input.rtoTargetSeconds }
        : {}),
    });
    return run;
  }

  async complete(
    id: string,
    input: {
      status: 'succeeded' | 'failed';
      evidence: Record<string, unknown>;
      rtoTargetSeconds?: number;
      correlationId?: string;
    },
  ) {
    const runs = await this.repo.listBackupRuns({ limit: 500 });
    const existing = runs.find((r) => r.id === id);
    if (!existing) {
      throw new NotFoundException({ code: 'BACKUP_RUN_NOT_FOUND', message: 'Unknown backup run id' });
    }
    if (input.status !== 'succeeded' && input.status !== 'failed') {
      throw new BadRequestException({
        code: 'BACKUP_STATUS_INVALID',
        message: 'status must be succeeded|failed',
      });
    }
    const finishedAt = new Date();
    await this.repo.completeBackupRun(id, {
      status: input.status,
      evidence: input.evidence,
      finishedAt,
    });
    await this.outbox.publish({
      aggregateType: 'backup_run',
      aggregateId: id,
      type: `sre.backup_${input.status}`,
      producer: 'sre',
      correlationId: input.correlationId,
      payload: { id, kind: existing.kind },
    });
    return {
      ...existing,
      status: input.status,
      finishedAt: finishedAt.toISOString(),
      evidence: input.evidence,
    };
  }

  list(filter?: { kind?: BackupKind; limit?: number }) {
    return this.repo.listBackupRuns(filter);
  }

  async status() {
    const last = await this.repo.lastSucceededFullBackup();
    return {
      lastSucceededFull: last ?? null,
      stalenessMinutes: backupStalenessMinutes(last),
    };
  }
}
