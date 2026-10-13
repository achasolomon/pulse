import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselySreRepository } from './../src/modules/sre/infrastructure/kysely-sre.repository.js';
import { AlertService } from './../src/modules/sre/application/alert.service.js';
import { BackupService } from './../src/modules/sre/application/backup.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('SRE alerts + backup/drill evidence (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let alerts: AlertService;
  let backups: BackupService;
  let repo: KyselySreRepository;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselySreRepository(db);
    alerts = new AlertService(repo, new OutboxService(db));
    backups = new BackupService(repo, new OutboxService(db));
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('seeded alert rules are present with runbook links; evaluate reports them', async () => {
    const rules = await alerts.rules();
    const names = rules.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['error_rate_p2', 'backup_staleness_p2']));
    const staleRule = rules.find((r) => r.name === 'backup_staleness_p2');
    expect(staleRule?.runbook).toContain('docs/runbooks/alerting.md');
    expect(staleRule?.severity).toBe('P2');
    expect(staleRule?.owner).toBe('sre-on-call');

    const res = await alerts.evaluate();
    expect(res.evaluated).toBeGreaterThanOrEqual(2);
    expect(res.results.length).toBe(res.evaluated);
  });

  it('full backup lifecycle: register -> running; complete -> succeeded; status staleness finite', async () => {
    const run = await backups.register({
      kind: 'full',
      rpoTargetMinutes: 1440,
      rtoTargetSeconds: 3600,
      correlationId: randomUUID(),
    });
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('running');
    expect(run.kind).toBe('full');

    const done = await backups.complete(run.id, {
      status: 'succeeded',
      evidence: { tables: 1, rowCountTotal: 1, checksums: { 'pg_class': 'x' } },
      correlationId: randomUUID(),
    });
    expect(done.status).toBe('succeeded');
    expect(done.evidence).toMatchObject({ tables: 1 });

    const status = await backups.status();
    expect(status.lastSucceededFull?.id).toBe(run.id);
    expect(status.stalenessMinutes).toBeLessThan(60);

    const list = await backups.list({ kind: 'full' });
    expect(list.some((r) => r.id === run.id)).toBe(true);
  });

  it('backup_staleness alert fires when RPO target is zero and resolves after a fresh backup', async () => {
    // Pin the seeded rule to a zero-minute RPO target: any existing backup
    // is therefore "stale", firing the alert deterministically.
    const rules = await db
      .selectFrom('ops.alert_rule')
      .selectAll()
      .where('name', '=', 'backup_staleness_p2')
      .executeTakeFirstOrThrow();
    // Drain any pre-existing firing instance (earlier evaluates / prior runs)
    // so this test observes a clean open -> resolve cycle.
    await db
      .updateTable('ops.alert_rule')
      .set({ threshold: 999999 })
      .where('id', '=', rules.id)
      .execute();
    await alerts.evaluate();
    await db
      .updateTable('ops.alert_rule')
      .set({ threshold: 0 })
      .where('id', '=', rules.id)
      .execute();

    const fired = await alerts.evaluate();
    const staleResult = fired.results.find((r) => r.rule === 'backup_staleness_p2');
    expect(staleResult?.breached).toBe(true);
    expect(staleResult?.state).toBe('firing');
    const firing = await alerts.alerts({ state: 'firing' });
    const staleAlert = firing.find((a) => a.ruleId === rules.id);
    expect(staleAlert).toBeTruthy();

    // Raise the threshold to a large value, register a fresh full backup,
    // and re-evaluate: the firing alert should now resolve.
    await db
      .updateTable('ops.alert_rule')
      .set({ threshold: 999999 })
      .where('id', '=', rules.id)
      .execute();
    await backups.register({ kind: 'full', rpoTargetMinutes: 1440 });
    const resolved = await alerts.evaluate();
    const resolveResult = resolved.results.find((r) => r.rule === 'backup_staleness_p2');
    expect(resolveResult?.breached).toBe(false);
    expect(resolveResult?.state).toBe('resolved');
  });
});
