// Explicit local UI test fixtures, never a production role/privilege policy.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { hashSecret, verifySecret } from '../apps/api/dist/modules/iam/domain/credentials.js';

assert.equal(process.env.PULSE_SEED_LOCAL_ROLES, 'yes', 'Explicit local seed opt-in required');
assert.notEqual(process.env.NODE_ENV, 'production');
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.port, '5436'); assert.equal(url.pathname, '/pulse');
const output = new URL('../tmp/local-role-credentials.json', import.meta.url);
let previous;
try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
const secret = previous?.secret ?? `PulseDemo!${randomBytes(6).toString('hex')}`;
const profiles = [
  ['demo.admin', 'administrator', true], ['demo.doctor', 'doctor', true],
  ['demo.nurse', 'nurse'], ['demo.reception', 'receptionist'], ['demo.records', 'records_officer'],
  ['demo.pharmacy', 'pharmacist'], ['demo.lab', 'lab_technician'],
  ['demo.radiology', 'radiologist'], ['demo.cashier', 'cashier'],
  ['demo.noaccess', null],
];
const db = new Pool({ connectionString: url.toString() });
const client = await db.connect();
try {
  await client.query('BEGIN');
  const org = (await client.query("INSERT INTO org.organization (name,code) VALUES ('Pulse Demo Health Group','LOCAL-ROLE-DEMO') ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING id")).rows[0];
  const facilities = [];
  for (const [code, name] of [['LOCAL-CGH', 'City General Hospital (Demo)'], ['LOCAL-RIVER', 'Riverside Clinic (Demo)']]) {
    facilities.push((await client.query('INSERT INTO org.facility (organization_id,name,code) VALUES ($1,$2,$3) ON CONFLICT (organization_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id,name', [org.id, name, code])).rows[0]);
  }
  for (const [loginId, role, multi] of profiles) {
    let credential = (await client.query('SELECT id,person_id,secret_hash,status FROM iam.credential WHERE login_id=$1', [loginId])).rows[0];
    if (credential) {
      assert.ok(previous?.accounts?.some((a) => a.loginId === loginId), 'Refusing to overwrite an account not created by this local seed');
      assert.ok(verifySecret(secret, credential.secret_hash));
      assert.equal(credential.status, 'active');
    } else {
      credential = (await client.query('INSERT INTO iam.credential (person_id,login_id,secret_hash) VALUES ($1,$2,$3) RETURNING id,person_id', [randomUUID(), loginId, hashSecret(secret)])).rows[0];
    }
    if (!role) continue;
    for (const facility of multi ? facilities : facilities.slice(0, 1)) {
      // No clinical or administrative privileges are invented for visual tests.
      await client.query('INSERT INTO iam.membership (person_id,organization_id,facility_id,roles,privileges) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM iam.membership WHERE person_id=$1 AND organization_id=$2 AND facility_id=$3)', [credential.person_id, org.id, facility.id, [role], []]);
    }
  }
  await client.query('COMMIT');
  await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify({ environment: 'Local Docker UI role testing', secret,
    facilities: facilities.map((f) => f.name), accounts: profiles.map(([loginId, role]) => ({ loginId, role: role ?? 'No facility access' })) }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Created/verified ${profiles.length} local accounts. Credentials saved to ignored ${fileURLToPath(output)}.`);
} catch (err) { await client.query('ROLLBACK'); throw err; }
finally { client.release(); await db.end(); }
