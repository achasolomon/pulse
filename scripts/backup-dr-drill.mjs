#!/usr/bin/env node
/**
 * Backup + restore drill (OPS-001 sections 65-66, F23.2/F23.3).
 *
 * Takes a logical full backup (pg_dump -Fc) of the target database, restores
 * it into an isolated scratch database on the same server, compares per-table
 * row counts and content checksums, and records the measured evidence in
 * ops.backup_run (kind=full for the backup, kind=restore_drill for the
 * verified restore). Fails non-zero on any mismatch.
 *
 * Env:
 *   DATABASE_URL          target connection (e.g. postgresql://pulse:pulse@localhost:5433/pulse)
 *   PULSE_PG_CONTAINER    docker container running postgres (default: pulse-pg-drill)
 *   PULSE_PG_USER         postgres user inside the container (default: pulse)
 *   PULSE_DB_NAME         database to back up (default: pulse)
 *   PULSE_RESTORE_DB      scratch restore target (default: pulse_restore_drill)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

const CONTAINER = process.env.PULSE_PG_CONTAINER ?? 'pulse-pg-drill';
const PGUSER = process.env.PULSE_PG_USER ?? 'pulse';
const DB = process.env.PULSE_DB_NAME ?? 'pulse';
const RESTORE_DB = process.env.PULSE_RESTORE_DB ?? 'pulse_restore_drill';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const CHECKSUM_TABLES = ['patient.patient', 'audit.audit_event', 'integration.outbox'];

function docker(...args) {
  return execFileSync('docker', args, { maxBuffer: 128 * 1024 * 1024 });
}

function rowCount(client, table) {
  return client.query(`SELECT count(*)::int AS n FROM ${table}`).then((r) => r.rows[0].n);
}

function withDb(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'pulse-drill-'));
  const dumpPath = join(scratch, `${DB}.dump`);
  const evidence = {
    container: CONTAINER,
    database: DB,
    checksums: {},
    tables: 0,
    rowCountTotal: 0,
    takenBy: 'backup-dr-drill.mjs',
  };

  try {
    // 1. Logical full backup (Buffer: pg_dump -Fc is binary).
    const t0 = Date.now();
    const dump = docker('exec', CONTAINER, 'pg_dump', '-U', PGUSER, '-Fc', DB);
    writeFileSync(dumpPath, dump);
    const sizeBytes = dump.byteLength;
    const dumpSeconds = Math.round((Date.now() - t0) / 1000);

    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    let restored;
    try {
      // 3. Isolated restore target, then measure restore RTO. The evidence
      //    rows are inserted AFTER comparison — inserting them first would
      //    grow the source and self-flag an ops.backup_run count mismatch.
      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
      await admin.query(`CREATE DATABASE ${RESTORE_DB}`);
      const t1 = Date.now();
      execFileSync(
        'docker',
        ['exec', '-i', CONTAINER, 'pg_restore', '-U', PGUSER, '-d', RESTORE_DB, '--no-owner', '--no-privileges'],
        { input: readFileSync(dumpPath), maxBuffer: 128 * 1024 * 1024 },
      );
      const restoreSeconds = Math.round((Date.now() - t1) / 1000);

      // 4. Compare row counts (all tables) + content checksums (key tables).
      let mismatch = false;
      restored = new Client({ connectionString: withDb(DATABASE_URL, RESTORE_DB) });
      await restored.connect();
      const tables = await admin.query(
        `SELECT (quote_ident(table_schema) || '.' || quote_ident(table_name)) AS t
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog','information_schema')
           AND table_type = 'BASE TABLE'
         ORDER BY t`,
      );
      evidence.tables = tables.rows.length;
      for (const { t } of tables.rows) {
        const a = await rowCount(admin, t);
        const b = await rowCount(restored, t);
        evidence.rowCountTotal += a;
        if (a !== b) {
          console.error(`COUNT MISMATCH ${t}: source=${a} restored=${b}`);
          mismatch = true;
        }
      }
      for (const t of CHECKSUM_TABLES) {
        const q = `SELECT md5(string_agg(row_text, '|' ORDER BY row_text)) AS c
                   FROM (SELECT t::text AS row_text FROM ${t} t) s`;
        const a = (await admin.query(q)).rows[0].c;
        const b = (await restored.query(q)).rows[0].c;
        evidence.checksums[t] = a === b ? 'match' : `MISMATCH source=${a} restored=${b}`;
        if (a !== b) mismatch = true;
      }

      // 5. Record the full backup + drill result, drop the scratch database
      //    (close the restored connection first — DROP fails on open sessions).
      const backupRow = await admin.query(
        `INSERT INTO ops.backup_run (kind, status, finished_at, rpo_target_minutes, rto_target_seconds, evidence)
         VALUES ('full', 'succeeded', now(), 1440, 3600, $1::jsonb) RETURNING id`,
        [JSON.stringify({ ...evidence, sizeBytes, dumpSeconds, verifiedByDrill: !mismatch })],
      );
      const backupId = backupRow.rows[0].id;
      await admin.query(
        `INSERT INTO ops.backup_run (kind, status, finished_at, rpo_target_minutes, rto_target_seconds, evidence)
         VALUES ('restore_drill', $1, now(), 1440, 3600, $2::jsonb)`,
        [
          mismatch ? 'failed' : 'succeeded',
          JSON.stringify({ ...evidence, restoreSeconds, backupRunId: backupId }),
        ],
      );
      await restored.end();
      restored = undefined;
      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
      console.log(
        JSON.stringify({ ok: !mismatch, backupId, dumpSeconds, restoreSeconds, ...evidence }, null, 2),
      );
      process.exitCode = mismatch ? 1 : 0;
    } finally {
      await restored?.end();
      await admin.end();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
