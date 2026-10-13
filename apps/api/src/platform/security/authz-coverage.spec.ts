/**
 * Authz coverage gate (SEC-001, IAM-001). Every controller except the explicit
 * public allowlist must carry an auth guard (staff TenantContextGuard,
 * partner key, or patient session) at class or method level.
 *
 * Add new public surfaces to PUBLIC_CONTROLLERS with justification — never
 * by deleting this test.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Controllers reachable without any credential by design.
const PUBLIC_CONTROLLERS = new Map<string, string>([
  ['app.controller.ts', 'root hello (no data)'],
  ['health.controller.ts', 'liveness/readiness probes'],
  ['metrics.controller.ts', 'scraper endpoint (no PHI labels)'],
]);
// NOTE: fhir.controller.ts stays guarded: /metadata is public by design but the
// file carries method-level PartnerApiKeyGuard, so it passes the marker check.

const GUARD_MARKERS = [
  'TenantContextGuard',
  'PartnerApiKeyGuard',
  'PatientSessionGuard',
  'AuthorizationGuard',
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('authz coverage gate', () => {
  it('every non-public controller carries an auth guard', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = join(here, '..', '..');
    const controllers = walk(join(src, 'modules'))
      .concat(walk(join(src, 'platform')))
      .concat(walk(src));
    expect(controllers.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of controllers) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (PUBLIC_CONTROLLERS.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      const guarded =
        GUARD_MARKERS.some((m) => text.includes(m)) || /@UseGuards\(/.test(text);
      if (!guarded) violations.push(name);
    }
    expect(violations).toEqual([]);
  });

  it('public allowlist stays justified and small', () => {
    expect(PUBLIC_CONTROLLERS.size).toBeLessThanOrEqual(5);
  });
});
