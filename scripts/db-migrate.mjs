/**
 * Minimal SQL migration runner (ADR-006). Applies infra/migrations/*.sql in order.
 * Tracks applied files in integration.schema_migrations (filename PK).
 * Usage:
 *   node scripts/db-migrate.mjs --dry-run
 *   Set DATABASE_URL (see infra/.env.example), then: node scripts/db-migrate.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'infra', 'migrations');
const dryRun = process.argv.includes('--dry-run');

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (dryRun) {
  console.log('Pending migrations:');
  for (const f of files) console.log(`  - ${f}`);
  process.exit(0);
}

const { Client } = await import('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (see infra/.env.example).');
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
await client.query(
  `CREATE SCHEMA IF NOT EXISTS integration;
   CREATE TABLE IF NOT EXISTS integration.schema_migrations (
     filename text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   );`,
);
const applied = new Set(
  (await client.query('SELECT filename FROM integration.schema_migrations'))
    .rows.map((r) => r.filename),
);

for (const f of files) {
  if (applied.has(f)) {
    console.log(`skip ${f} (applied)`);
    continue;
  }
  console.log(`apply ${f}`);
  const sql = readFileSync(join(DIR, f), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO integration.schema_migrations (filename) VALUES ($1)',
      [f],
    );
    await client.query('COMMIT');
    console.log(`applied ${f}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`failed ${f}: ${err instanceof Error ? err.message : String(err)}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log('migrations complete');
