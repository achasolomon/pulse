/**
 * SCA gate (SEC-001 section 86, EPIC-22): dependency vulnerability scan.
 * Runs pnpm audit and fails on high/critical advisories.
 * Usage: node scripts/check-sca.mjs [--json]
 * Exit codes: 0 clean/low-only, 1 high+ findings, 2 scan unavailable.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const res = spawnSync('pnpm', ['audit', '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  timeout: 120_000,
});

if (res.error || res.status === null) {
  console.error(`sca: audit unavailable (${res.error?.message ?? 'no exit code'})`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(res.stdout || '{}');
} catch {
  console.error('sca: could not parse pnpm audit JSON output');
  process.exit(2);
}

// pnpm audit --json: { advisories: { <id>: { severity, module_name, title, ... } }, metadata: { vulnerabilities: { critical, high, moderate, low, info } } }
const advisories = report.advisories ?? {};
const rows = Object.entries(advisories).map(([id, a]) => ({
  id,
  severity: a.severity,
  module: a.module_name,
  title: a.title,
}));
const blocking = rows.filter((r) => r.severity === 'high' || r.severity === 'critical');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ blocking, all: rows }, null, 2));
} else {
  for (const r of blocking) {
    console.log(`sca: ${r.severity.toUpperCase()} ${r.id} ${r.module} — ${r.title}`);
  }
  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(
    `sca: critical=${counts.critical ?? 0} high=${counts.high ?? 0} moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`,
  );
}

process.exit(blocking.length > 0 ? 1 : 0);
