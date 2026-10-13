import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyFindingRepository } from './../src/modules/security/infrastructure/kysely-finding.repository.js';
import { FindingService } from './../src/modules/security/application/finding.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

interface Advisory {
  severity: string;
  module_name: string;
  title: string;
}

function currentAdvisories(): Advisory[] | undefined {
  const root = join(process.cwd(), '..', '..');
  const res = spawnSync('pnpm', ['audit', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  });
  if (res.error || res.status === null) return undefined;
  try {
    const report = JSON.parse(res.stdout || '{}') as { advisories?: Record<string, Advisory> };
    return Object.values(report.advisories ?? {});
  } catch {
    return undefined;
  }
}

/**
 * SCA release-gate triage engagement (SEC-001 §86, F22.1, SPRINT_31 D5).
 * Intakes the CURRENT high/critical advisory set into the findings register
 * (one finding per package, evidence = advisory titles) and triages it —
 * proving the full SCA -> findings -> triage loop against live data.
 * Each run records a point-in-time engagement; registry-unreachable runs skip.
 */
describe.skipIf(!hasDb)('SCA advisory triage engagement (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let findings: FindingService;
  const advisories = currentAdvisories();

  beforeAll(() => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    findings = new FindingService(new KyselyFindingRepository(db), new OutboxService(db));
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it.skipIf(!advisories)('intakes and triages current high/critical advisories per package', async () => {
    const blocking = (advisories ?? []).filter(
      (a) => a.severity === 'high' || a.severity === 'critical',
    );
    expect(blocking.length).toBeGreaterThan(0);

    const byPackage = new Map<string, Advisory[]>();
    for (const a of blocking) {
      const list = byPackage.get(a.module_name) ?? [];
      list.push(a);
      byPackage.set(a.module_name, list);
    }

    const ownerFor = (pkg: string): string =>
      pkg.startsWith('next') ? 'web-platform' : 'api-platform';

    for (const [pkg, items] of byPackage) {
      const criticals = items.filter((i) => i.severity === 'critical').length;
      const highs = items.filter((i) => i.severity === 'high').length;
      const severity = criticals > 0 ? 'critical' : 'high';
      const finding = await findings.create({
        title: `SCA advisories: ${pkg} (${criticals} critical, ${highs} high)`,
        severity,
        component: `deps/${pkg}`,
        evidence: items
          .map((i) => `${i.severity}: ${i.title}`)
          .join(' | ')
          .slice(0, 1500),
        owner: ownerFor(pkg),
        remediation: 'Upgrade to patched release in the dependency train; re-run check-sca.mjs',
      });
      const triaged = await findings.act(finding.id, 'triage', {
        triagedBy: 'sca-gate',
        owner: ownerFor(pkg),
        remediation: 'Scheduled dependency upgrade; tracked as release-gate follow-on (SPRINT_31)',
      });
      expect(triaged.status).toBe('triaged');
      expect(triaged.owner).toBe(ownerFor(pkg));
      expect(triaged.triagedBy).toBe('sca-gate');
    }

    const triagedFindings = await findings.list({ status: 'triaged' });
    expect(triagedFindings.filter((f) => f.component.startsWith('deps/')).length).toBeGreaterThanOrEqual(
      byPackage.size,
    );
  });
});
