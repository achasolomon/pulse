/**
 * Secret scan (SEC-001, EPIC-22). Fails on likely-committed secrets in source.
 * Usage: node scripts/check-secrets.mjs
 * Keep the allowlist tiny and justified; fixtures use obviously-fake values.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['apps', 'packages', 'scripts', 'infra'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);
const SKIP_FILES = new Set(['pnpm-lock.yaml']);

const PATTERNS = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'postgres-url-with-password', re: /postgres(ql)?:\/\/[^/\s:]+:[^/\s@]+@/ },
  { name: 'mongodb-url-with-password', re: /mongodb(\+srv)?:\/\/[^/\s:]+:[^/\s@]+@/ },
  { name: 'generic-password-assign', re: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i },
  { name: 'api-key-assign', re: /(api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { name: 'bearer-token-literal', re: /Bearer [A-Za-z0-9\-_.~+/]{20,}/ },
  { name: 'x-api-key-literal', re: /x-api-key['"]?\s*[:=]\s*['"]pulse_[A-Za-z0-9]{16,}/ },
];

// Allowlisted (path substring -> justification). Secrets here must be fake/test-only.
const ALLOW = [
  { sub: 'check-secrets.mjs', why: 'the patterns themselves' },
  { sub: '.env.example', why: 'placeholder credentials (pulse/pulse local only)' },
  { sub: 'infra/README.md', why: 'local-dev placeholder credentials' },
  { sub: 'infra/migrations', why: 'docs mention DATABASE_URL placeholder' },
  { sub: 'test/', why: 'spec fixtures use fake values (pulse-dev-partner, 00000000 UUIDs)' },
  { sub: 'platform.e2e-spec.ts', why: 'fake bearer/demo values' },
  { sub: 'docs/', why: 'documentation placeholders' },
  { sub: 'backup-dr-drill.mjs', why: 'local-dev placeholder DATABASE_URL in usage docs' },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!SKIP_FILES.has(e) && /\.(ts|js|mjs|json|yml|yaml|md|sql|env.*)$/.test(e)) out.push(p);
  }
  return out;
}

function allowed(file) {
  return ALLOW.some((a) => file.replace(/\\/g, '/').includes(a.sub));
}

let violations = 0;
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (allowed(rel)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const p of PATTERNS) {
      if (p.re.test(text)) {
        console.error(`SECRET? [${p.name}] ${rel}`);
        violations++;
      }
    }
  }
}
if (violations > 0) {
  console.error(`${violations} potential secret(s). Remove or justify in ALLOW.`);
  process.exit(1);
}
console.log('secrets scan clean.');
