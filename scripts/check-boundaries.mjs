/**
 * Boundary check per ADR-001 / PULSE-ENG-001 section 11-13 / PULSE-BE-001 section 6.
 *
 * Rules:
 * 1. modules/<A> must not import modules/<B>/infrastructure (or entities/persistence) when A !== B.
 *    Cross-domain collaboration only via application contracts, domain events, or explicit application ports.
 * 2. platform/** must not import from modules/** (dependency direction: modules -> platform).
 * 3. Direct cross-schema table writes are a DB review concern; this script guards the source-level seam.
 *
 * Usage: node scripts/check-boundaries.mjs [--strict]
 * Exit 1 on violation with file:line evidence.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const SRC = join(ROOT, 'apps', 'api', 'src');
const MODULES = join(SRC, 'modules');
const PLATFORM = join(SRC, 'platform');

const IMPORT_RE =
  /(?:import\s[^'"]*from\s*|import\s*\(\s*|require\s*\()\s*['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e) && !/\.spec\.ts$/.test(e)) out.push(p);
  }
  return out;
}

function ownerOf(file) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const m = rel.match(/^modules\/([^/]+)\//);
  if (m) return { kind: 'module', owner: m[1], rel };
  if (rel.startsWith('platform/')) return { kind: 'platform', owner: 'platform', rel };
  return { kind: 'other', owner: '-', rel };
}

function resolveTargetOwner(importer, spec) {
  if (spec.startsWith('.')) {
    // relative — resolve against importer dir
    const base = join(importer, '..', spec).replace(/\\/g, '/');
    const rel = relative(SRC, base).replace(/\\/g, '/');
    const m = rel.match(/modules\/([^/]+)\//);
    if (m) {
      const infra = /modules\/[^/]+\/(infrastructure|entities|persistence)/.test(rel);
      return { owner: m[1], infra, rel };
    }
    if (rel.startsWith('platform/')) return { owner: 'platform', infra: false, rel };
    return null;
  }
  // alias / package-style: @modules/<domain>/... or modules/<domain>/...
  const m = spec.match(/(?:@modules\/|modules\/)([^/'"]+)/);
  if (m) {
    const infra = /(infrastructure|entities|persistence)/.test(spec);
    return { owner: m[1], infra, rel: spec };
  }
  if (spec.includes('platform/')) return { owner: 'platform', infra: false, rel: spec };
  return null;
}

const violations = [];
const files = [...walk(MODULES), ...walk(PLATFORM)];

for (const file of files) {
  const src = ownerOf(file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const spec = m[1];
      const target = resolveTargetOwner(file, spec);
      if (!target) continue;
      // Rule 1: cross-module infrastructure import
      if (
        src.kind === 'module' &&
        target.owner !== src.owner &&
        target.owner !== 'platform' &&
        target.infra
      ) {
        violations.push(
          `${relative(ROOT, file)}:${i + 1} modules/${src.owner} -> modules/${target.owner}/infrastructure (${spec})`,
        );
      }
      // Rule 2: platform -> modules
      if (src.kind === 'platform' && target.owner !== 'platform' && target.owner) {
        // allow type-only contract packages, block src/modules deep imports
        if (/modules\//.test(spec) || /modules\//.test(target.rel)) {
          violations.push(
            `${relative(ROOT, file)}:${i + 1} platform -> modules/${target.owner} (${spec})`,
          );
        }
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Boundary violations (ADR-001):');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
} else {
  console.log(`Boundaries ok (${files.length} files scanned).`);
}
