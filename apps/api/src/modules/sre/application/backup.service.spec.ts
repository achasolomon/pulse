import { BackupService } from './backup.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import type { BackupKind, BackupRun, SreRepository } from '../domain/sre.repository.js';

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

function store() {
  const rows = new Map<string, BackupRun>();
  let seq = 0;
  const repo: SreRepository = {
    listRules: async () => [],
    findFiring: async () => undefined,
    openAlert: async () => {
      throw new Error('not used');
    },
    updateAlertValue: async () => {
      throw new Error('not used');
    },
    resolveAlert: async () => {
      throw new Error('not used');
    },
    listAlerts: async () => [],
    createBackupRun: async (input) => {
      seq += 1;
      const r: BackupRun = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        kind: input.kind,
        status: 'running',
        startedAt: new Date().toISOString(),
        ...(input.rpoTargetMinutes !== undefined
          ? { rpoTargetMinutes: input.rpoTargetMinutes }
          : {}),
        ...(input.rtoTargetSeconds !== undefined
          ? { rtoTargetSeconds: input.rtoTargetSeconds }
          : {}),
        evidence: {},
      };
      rows.set(r.id, r);
      return r;
    },
    completeBackupRun: async (id, input) => {
      const r = rows.get(id);
      if (r) {
        r.status = input.status;
        r.finishedAt = input.finishedAt.toISOString();
        r.evidence = input.evidence;
      }
    },
    lastSucceededFullBackup: async () =>
      [...rows.values()].find((r) => r.kind === 'full' && r.status === 'succeeded'),
    listBackupRuns: async (filter) =>
      [...rows.values()].filter((r) => !filter?.kind || r.kind === filter.kind),
  };
  return { rows, repo };
}

const svc = (repo: SreRepository) => new BackupService(repo, new OutboxService(undefined));

describe('BackupService (unit, fakes)', () => {
  it('register creates a running run; complete stores evidence and finish time', async () => {
    const st = store();
    const run = await svc(st.repo).register({
      kind: 'full',
      rpoTargetMinutes: 1440,
      rtoTargetSeconds: 3600,
    });
    expect(run.status).toBe('running');
    expect(run.rpoTargetMinutes).toBe(1440);
    const done = await svc(st.repo).complete(run.id, {
      status: 'succeeded',
      evidence: { tables: 42, rowCountTotal: 1200 },
    });
    expect(done.status).toBe('succeeded');
    expect(done.evidence).toMatchObject({ tables: 42 });
    expect(done.finishedAt).toBeTruthy();
  });

  it('register rejects unknown kinds; complete rejects unknown id and bad status', async () => {
    const st = store();
    const s = svc(st.repo);
    await expectCode(
      s.register({ kind: 'tape' as BackupKind }),
      'BACKUP_KIND_INVALID',
      400,
    );
    await expectCode(
      s.complete('00000000-0000-4000-8000-000000000099', {
        status: 'succeeded',
        evidence: {},
      }),
      'BACKUP_RUN_NOT_FOUND',
      404,
    );
    const run = await s.register({ kind: 'wal' });
    await expectCode(
      s.complete(run.id, { status: 'maybe' as 'failed', evidence: {} }),
      'BACKUP_STATUS_INVALID',
      400,
    );
  });

  it('status reports staleness from last succeeded full backup', async () => {
    const st = store();
    const s = svc(st.repo);
    const empty = await s.status();
    expect(empty.lastSucceededFull).toBeNull();
    expect(empty.stalenessMinutes).toBe(Number.POSITIVE_INFINITY);
    const run = await s.register({ kind: 'full' });
    await s.complete(run.id, { status: 'succeeded', evidence: {} });
    const full = await s.status();
    expect(full.lastSucceededFull?.id).toBe(run.id);
    expect(full.stalenessMinutes).toBeGreaterThanOrEqual(0);
  });
});
