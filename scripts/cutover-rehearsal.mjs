#!/usr/bin/env node
/**
 * Cutover dress rehearsal (MIG-001 sections 75-78/80, Appendix B; MIG-SR-018).
 *
 * Timed rehearsal against a source "legacy" environment and a fresh target:
 *   1 baseline   control totals (row counts + content checksums) per table
 *   2 delta      idempotent late-arriving change fixture (repeated delta must
 *                not change the watermark) -> transfer baseline
 *   3 migrate    target schema from source-controlled migrations only
 *   4 load       data-only dump -> restore into target (timed)
 *   5 freeze     source must be bit-identical across the transfer window
 *   6 reconcile  target vs transfer baseline; any mismatch = M0 defect -> NO-GO
 *                + clinical sample validation (representative records present)
 *   7 rollback   decision drill: revert target to a clean migrated known-good,
 *                timed (MIG-001 section 77)
 * Emits a JSON verdict with phase timings and a cutover window estimate
 * (load+migrate+reconcile + contingency, MIG-001 section 78).
 *
 * Env:
 *   DATABASE_URL   source environment (see infra/.env.example)
 *   TARGET_DB      target database name on the same server (default: pulse_cutover)
 * Args:
 *   --docker <container>   run pg_dump/pg_restore inside the container
 *   --keep-target          skip the rollback drill (keep the loaded target)
 * Exit codes: 0 = GO, 1 = NO-GO (or tooling failure).
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const CONTAINER = dockerIdx >= 0 ? args[dockerIdx + 1] : undefined;
const KEEP_TARGET = args.includes('--keep-target');
const TARGET_DB = process.env.TARGET_DB ?? 'pulse_cutover';
const SOURCE_URL = process.env.DATABASE_URL;
if (!SOURCE_URL && !args.includes('--self-test')) {
  console.error('DATABASE_URL is required (see infra/.env.example).');
  process.exit(1);
}

const DELTA_ID = '00000000-0000-4000-8000-00000000d001';
const CONTINGENCY = 1.5; // section 78: window estimate includes contingency

function withDb(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function maintenanceUrl() {
  return withDb(SOURCE_URL, 'postgres');
}

function run(cmd, cmdArgs, input) {
  return execFileSync(cmd, cmdArgs, {
    maxBuffer: 128 * 1024 * 1024,
    ...(input !== undefined ? { input } : {}),
  });
}

function pg(args2, input) {
  if (CONTAINER) return run('docker', ['exec', '-i', CONTAINER, ...args2], input);
  return run(args2[0], args2.slice(1), input);
}

async function withClient(url, fn) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Clear migration-seeded rows (source owns data AND configuration). */
async function clearSeededRows(url) {
  return withClient(url, (c) =>
    c.query(
      `DO $$
       DECLARE r record;
       BEGIN
         FOR r IN
           SELECT quote_ident(table_schema) || '.' || quote_ident(table_name) AS t
           FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog','information_schema')
             AND table_type = 'BASE TABLE'
             AND NOT (table_schema = 'integration' AND table_name = 'schema_migrations')
         LOOP
           EXECUTE format('TRUNCATE %s CASCADE', r.t);
         END LOOP;
       END $$;`,
    ),
  );
}

/** Control totals: row count + ordered content md5 for every base table. */
async function manifest(url) {
  return withClient(url, async (c) => {
    const tables = await c.query(
      `SELECT (quote_ident(table_schema) || '.' || quote_ident(table_name)) AS t
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
         AND table_type = 'BASE TABLE'
         AND NOT (table_schema = 'integration' AND table_name = 'schema_migrations')
       ORDER BY t`,
    );
    const m = {};
    for (const { t } of tables.rows) {
      const n = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      const h = (
        await c.query(
          `SELECT md5(string_agg(row_text, '|' ORDER BY row_text)) AS h
           FROM (SELECT x::text AS row_text FROM ${t} x) s`,
        )
      ).rows[0].h;
      m[t] = { rows: n, checksum: h };
    }
    return m;
  });
}

function diffManifests(a, b) {
  const defects = [];
  const tables = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const t of tables) {
    const x = a[t];
    const y = b[t];
    if (!x) defects.push({ table: t, problem: 'missing-in-source', target: y.rows });
    else if (!y) defects.push({ table: t, problem: 'missing-in-target', source: x.rows });
    else if (x.rows !== y.rows || x.checksum !== y.checksum) {
      defects.push({ table: t, problem: 'mismatch', source: x.rows, target: y.rows });
    }
  }
  return defects;
}

function deltaReport(a, b) {
  const changed = [];
  for (const t of Object.keys(b).sort()) {
    const before = a[t]?.rows ?? 0;
    if (before !== b[t].rows) changed.push({ table: t, from: before, to: b[t].rows });
  }
  return changed;
}

function migrateChild(targetUrl) {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'db-migrate.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: targetUrl },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function main() {
  if (args.includes('--self-test')) {
    // Pure-function check of the NO-GO math: mismatches, missing tables,
    // clean equality, and delta reporting.
    const a = { t1: { rows: 2, checksum: 'x' }, t2: { rows: 1, checksum: 'y' } };
    const bad = { t1: { rows: 2, checksum: 'CHANGED' }, t3: { rows: 9, checksum: 'z' } };
    const defects = diffManifests(a, bad);
    const ok =
      defects.length === 3 &&
      defects.some((d) => d.table === 't1' && d.problem === 'mismatch') &&
      defects.some((d) => d.table === 't2' && d.problem === 'missing-in-target') &&
      defects.some((d) => d.table === 't3' && d.problem === 'missing-in-source') &&
      diffManifests(a, a).length === 0 &&
      JSON.stringify(deltaReport(a, { ...a, t1: { rows: 5, checksum: 'x' } })) ===
        JSON.stringify([{ table: 't1', from: 2, to: 5 }]);
    console.log(JSON.stringify({ selfTest: ok ? 'pass' : 'FAIL', defects }));
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const targetUrl = withDb(SOURCE_URL, TARGET_DB);
  const t = {};
  const mark = (name) => {
    t[name] = Date.now();
    return t[name];
  };
  const ms = (from, to) => Math.round((to - from) / 1000);

  console.error(`[rehearsal] source -> ${TARGET_DB}${CONTAINER ? ` (container ${CONTAINER})` : ' (local pg tools)'}`);

  // --- 1. Baseline manifest -------------------------------------------------
  let p = mark('baselineStart');
  const baseline = await manifest(SOURCE_URL);
  t.baseline = ms(p, mark('baselineEnd'));
  console.error(`[rehearsal] baseline: ${Object.keys(baseline).length} tables`);

  // --- 2. Delta fixture (idempotent; section 80) ---------------------------
  p = mark('deltaStart');
  const insertDelta = (c) =>
    c.query(
      `INSERT INTO integration.outbox
         (id, aggregate_type, aggregate_id, type, version, occurred_at, producer, payload)
       VALUES ($1, 'cutover_rehearsal', $1, 'rehearsal.delta_marker', 1, now(),
               'cutover_rehearsal', '{"note":"simulated late-arriving change"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [DELTA_ID],
    );
  await withClient(SOURCE_URL, insertDelta);
  const afterFirst = await manifest(SOURCE_URL);
  await withClient(SOURCE_URL, insertDelta);
  const transferBaseline = await manifest(SOURCE_URL);
  const deltaIdempotent =
    JSON.stringify(afterFirst) === JSON.stringify(transferBaseline);
  const delta = deltaReport(baseline, transferBaseline);
  t.delta = ms(p, mark('deltaEnd'));
  console.error(`[rehearsal] delta: ${JSON.stringify(delta)} idempotent=${deltaIdempotent}`);

  // --- 3. Migrate target (schema from migrations only) ---------------------
  p = mark('migrateStart');
  await withClient(maintenanceUrl(), async (m) => {
    await m.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`);
    await m.query(`CREATE DATABASE ${TARGET_DB}`);
  });
  migrateChild(targetUrl);
  // Migrations may seed config rows (e.g. alert rules). The source is the
  // system of record for data AND configuration: clear them so the data-only
  // load lands without PK conflicts and carries source values. The cleared,
  // migrated schema is the deterministic known-good state for the rollback
  // drill (fresh seeds carry run-varying now() timestamps).
  await clearSeededRows(targetUrl);
  const migratedKnownGood = await manifest(targetUrl);
  t.migrate = ms(p, mark('migrateEnd'));
  console.error(`[rehearsal] target migrated (${t.migrate}s)`);

  // --- 4. Data-only load (timed) ------------------------------------------
  p = mark('loadStart');
  const dump = CONTAINER
    ? run('docker', [
        'exec', CONTAINER, 'pg_dump', '-U', 'pulse',
        '--data-only', '--exclude-table=integration.schema_migrations',
        '-Fc', 'pulse',
      ])
    : run('pg_dump', [
        '--data-only', '--exclude-table=integration.schema_migrations', '-Fc',
        SOURCE_URL,
      ]);
  if (CONTAINER) {
    run('docker', ['exec', '-i', CONTAINER, 'pg_restore', '-U', 'pulse',
      '-d', TARGET_DB, '--disable-triggers', '--no-owner'], dump);
  } else {
    run('pg_restore', ['-d', targetUrl, '--disable-triggers', '--no-owner'], dump);
  }
  t.load = ms(p, mark('loadEnd'));
  console.error(`[rehearsal] load: ${dump.byteLength} bytes in ${t.load}s`);

  // --- 5. Freeze verification (section 79) ---------------------------------
  p = mark('freezeStart');
  const sourceNow = await manifest(SOURCE_URL);
  const freezeClean = JSON.stringify(sourceNow) === JSON.stringify(transferBaseline);
  t.freeze = ms(p, mark('freezeEnd'));

  // --- 6. Reconciliation + clinical sample ---------------------------------
  p = mark('reconcileStart');
  const target = await manifest(targetUrl);
  const defects = diffManifests(transferBaseline, target);
  const sample = await withClient(targetUrl, async (c) => {
    const r = await c.query(
      `SELECT
         (SELECT count(*)::int FROM patient.patient)     AS patients,
         (SELECT count(*)::int FROM encounter.encounter) AS encounters,
         (SELECT count(*)::int FROM clin.note)           AS notes,
         (SELECT count(*)::int FROM clin.note WHERE status = 'signed') AS signed`,
    );
    return r.rows[0];
  });
  const clinicalOk = sample.patients > 0 && sample.encounters > 0
    && sample.notes > 0 && sample.signed > 0;
  t.reconcile = ms(p, mark('reconcileEnd'));

  // --- 7. Rollback decision drill (section 77) -----------------------------
  let rollback = null;
  if (!KEEP_TARGET) {
    p = mark('rollbackStart');
    await withClient(maintenanceUrl(), async (m) => {
      await m.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`);
      await m.query(`CREATE DATABASE ${TARGET_DB}`);
    });
    migrateChild(targetUrl);
    await clearSeededRows(targetUrl);
    const reverted = await manifest(targetUrl);
    const revertedClean =
      JSON.stringify(reverted) === JSON.stringify(migratedKnownGood);
    rollback = { seconds: ms(p, mark('rollbackEnd')), revertedClean };
    console.error(`[rehearsal] rollback drill: clean=${revertedClean} (${rollback.seconds}s)`);
  }

  // --- Verdict --------------------------------------------------------------
  const freezeViolations = freezeClean ? [] : ['source changed during transfer window'];
  const problems = [
    ...(deltaIdempotent ? [] : ['delta not idempotent']),
    ...freezeViolations,
    ...defects.map((d) => `M0 ${d.problem}: ${d.table}`),
    ...(clinicalOk ? [] : ['clinical sample validation failed']),
    ...(rollback && !rollback.revertedClean ? ['rollback drill failed'] : []),
  ];
  const verdict = problems.length === 0 ? 'GO' : 'NO-GO';
  const coreSeconds = t.migrate + t.load + t.reconcile;
  const summary = {
    verdict,
    source: new URL(SOURCE_URL).host,
    targetDb: TARGET_DB,
    tables: Object.keys(transferBaseline).length,
    totalRows: Object.values(transferBaseline).reduce((s, v) => s + v.rows, 0),
    delta,
    deltaIdempotent,
    freezeClean,
    clinicalSample: sample,
    defects,
    rollback,
    phasesSeconds: {
      baseline: t.baseline,
      delta: t.delta,
      migrate: t.migrate,
      load: t.load,
      freeze: t.freeze,
      reconcile: t.reconcile,
      ...(rollback ? { rollback: rollback.seconds } : {}),
    },
    cutoverWindowEstimateSeconds: Math.ceil(coreSeconds * CONTINGENCY),
    problems,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = verdict === 'GO' ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
