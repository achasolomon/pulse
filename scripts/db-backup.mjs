/**
 * Database backup wrapper (OPS-001 backup, EPIC-23).
 * Uses pg_dump custom format when available, then verifies the archive with
 * pg_restore --list. Prefers the container's pg_dump via --docker flag:
 *   node scripts/db-backup.mjs --docker pulse-postgres
 *   DATABASE_URL=... node scripts/db-backup.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const container = dockerIdx >= 0 ? args[dockerIdx + 1] : undefined;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = `backups/pulse-${stamp}.dump`;

async function run(cmd, cmdArgs) {
  try {
    const { stdout, stderr } = await exec(cmd, cmdArgs);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (err) {
    console.error(`FAILED: ${cmd} ${cmdArgs.join(' ')}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (container) {
  await run('docker', ['exec', container, 'pg_dump', '-U', 'pulse', '-Fc', '-f', `/tmp/backup.dump`, 'pulse']);
  await run('docker', ['cp', `${container}:/tmp/backup.dump`, out]);
  await run('docker', ['exec', container, 'pg_restore', '--list', '/tmp/backup.dump']);
} else {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (or use --docker <container>). See infra/.env.example.');
    process.exit(1);
  }
  await run('pg_dump', [url, '-Fc', '-f', out]);
  await run('pg_restore', ['--list', out]);
}
console.log(`backup verified: ${out}`);
