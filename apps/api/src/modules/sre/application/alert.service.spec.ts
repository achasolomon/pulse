import { AlertService } from './alert.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { metricsRegistry } from '../../../platform/observability/metrics.registry.js';
import type {
  Alert,
  AlertRule,
  BackupRun,
  SreRepository,
} from '../domain/sre.repository.js';

const RULE: AlertRule = {
  id: '00000000-0000-4000-8000-00000000b001',
  name: 'error_rate_p2',
  description: '5xx rate',
  metric: 'error_rate',
  comparator: '>=',
  threshold: 0.05,
  windowMinutes: 15,
  severity: 'P2',
  owner: 'sre-on-call',
  runbook: 'docs/runbooks/alerting.md',
  enabled: true,
};

const BACKUP_RULE: AlertRule = {
  ...RULE,
  id: '00000000-0000-4000-8000-00000000b002',
  name: 'backup_staleness_p2',
  metric: 'backup_staleness_minutes',
  comparator: '>',
  threshold: 1500,
};

function store(rules: AlertRule[], lastBackup?: BackupRun) {
  const alerts = new Map<string, Alert>();
  let seq = 0;
  const repo: SreRepository = {
    listRules: async (enabledOnly) =>
      enabledOnly ? rules.filter((r) => r.enabled) : rules,
    findFiring: async (ruleId) =>
      [...alerts.values()].find((a) => a.ruleId === ruleId && a.state === 'firing'),
    openAlert: async (input) => {
      seq += 1;
      const a: Alert = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        ruleId: input.ruleId,
        state: 'firing',
        value: input.value,
        startedAt: new Date().toISOString(),
        detail: input.detail,
      };
      alerts.set(a.id, a);
      return a;
    },
    updateAlertValue: async (id, value) => {
      const a = alerts.get(id);
      if (a) a.value = value;
    },
    resolveAlert: async (id, value) => {
      const a = alerts.get(id);
      if (a) {
        a.state = 'resolved';
        a.value = value;
        a.resolvedAt = new Date().toISOString();
      }
    },
    listAlerts: async (filter) =>
      [...alerts.values()].filter((a) => !filter?.state || a.state === filter.state),
    createBackupRun: async () => {
      throw new Error('not used');
    },
    completeBackupRun: async () => {
      throw new Error('not used');
    },
    lastSucceededFullBackup: async () => lastBackup,
    listBackupRuns: async () => [],
  };
  return { alerts, repo };
}

describe('AlertService (unit, fakes)', () => {
  beforeEach(() => metricsRegistry.reset());

  const svc = (repo: SreRepository) => new AlertService(repo, new OutboxService(undefined));

  it('does not fire when error rate is under threshold (no traffic = 0)', async () => {
    const st = store([RULE]);
    const res = await svc(st.repo).evaluate();
    expect(res.evaluated).toBe(1);
    expect(res.results[0]).toMatchObject({ rule: 'error_rate_p2', breached: false, state: 'unchanged' });
    expect(await st.repo.listAlerts()).toHaveLength(0);
  });

  it('fires once on breach (deduped), then resolves on recovery', async () => {
    metricsRegistry.observe({ handler: 'A.b', method: 'GET', status: 500, durationMs: 5 });
    metricsRegistry.observe({ handler: 'A.b', method: 'GET', status: 200, durationMs: 5 });
    const st = store([RULE]);
    const s = svc(st.repo);

    const first = await s.evaluate();
    expect(first.results[0]).toMatchObject({ breached: true, state: 'firing' });
    const second = await s.evaluate();
    expect(second.results[0]).toMatchObject({ breached: true, state: 'unchanged' });
    const firing = await st.repo.listAlerts({ state: 'firing' });
    expect(firing).toHaveLength(1);

    metricsRegistry.reset(); // traffic recovers
    const third = await s.evaluate();
    expect(third.results[0]).toMatchObject({ breached: false, state: 'resolved' });
    expect(await st.repo.listAlerts({ state: 'firing' })).toHaveLength(0);
  });

  it('backup staleness fires when last full backup is older than RPO target', async () => {
    const old: BackupRun = {
      id: '00000000-0000-4000-8000-00000000c001',
      kind: 'full',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString(),
      evidence: {},
    };
    const fresh: BackupRun = { ...old, finishedAt: new Date().toISOString() };

    const staleStore = store([BACKUP_RULE], old);
    const res1 = await svc(staleStore.repo).evaluate();
    expect(res1.results[0]).toMatchObject({ breached: true, state: 'firing' });

    const freshStore = store([BACKUP_RULE], fresh);
    const res2 = await svc(freshStore.repo).evaluate();
    expect(res2.results[0]).toMatchObject({ breached: false, state: 'unchanged' });
  });

  it('disabled rules are skipped', async () => {
    const st = store([{ ...RULE, enabled: false }]);
    const res = await svc(st.repo).evaluate();
    expect(res.evaluated).toBe(0);
  });
});
