// Explicit local UI preview fixtures; never a production access policy.
import assert from 'node:assert/strict';
import { Pool } from 'pg';
assert.equal(process.env.PULSE_SEED_LOCAL_PATIENTS, 'yes', 'Explicit local preview opt-in required');
assert.notEqual(process.env.NODE_ENV, 'production');
const url = new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
assert.equal(url.port,'5436'); assert.equal(url.pathname,'/pulse');
const db = new Pool({ connectionString: url.toString() });
const client = await db.connect();
try {
  await client.query('BEGIN');
  const org = (await client.query("SELECT id FROM org.organization WHERE code='LOCAL-ROLE-DEMO'")).rows[0];
  assert.ok(org, 'Create the local demo organization first');
  const facilities = (await client.query("SELECT id,code FROM org.facility WHERE organization_id=$1 AND code IN ('LOCAL-CGH','LOCAL-RIVER')",[org.id])).rows;
  assert.equal(facilities.length,2);
  const accounts = (await client.query("SELECT c.person_id,c.login_id,m.id AS membership_id,m.facility_id FROM iam.credential c JOIN iam.membership m ON m.person_id=c.person_id WHERE m.organization_id=$1 AND c.login_id IN ('demo.admin','demo.doctor','demo.nurse','demo.reception','demo.records') AND c.status='active'",[org.id])).rows;
  assert.ok(accounts.length >= 4);
  for (const account of accounts) {
    const grants = {
      'demo.records': ['patient:read','patient:write','appointment:read','appointment:check-in','encounter:read','encounter:write'],
      'demo.reception': ['patient:read','appointment:read','appointment:check-in','encounter:read','encounter:write'],
      'demo.nurse': ['patient:read','observation:read','observation:write','entry:read','encounter:read'],
      'demo.doctor': ['patient:read','observation:read','entry:read','entry:write','encounter:read','encounter:consult'],
      'demo.admin': ['patient:read','patient:write','observation:read','observation:write','entry:read','entry:write','appointment:read','appointment:check-in','encounter:read','encounter:write','encounter:consult'],
    };
    const historyReads = ['demo.admin','demo.doctor','demo.nurse'].includes(account.login_id) ? ['note:read','medication:read','lab:read','imaging:view','document:read'] : [];
    const noteWrites = ['demo.admin','demo.doctor','demo.nurse'].includes(account.login_id) ? ['note:write','note:sign','note:amend',...(['demo.admin','demo.nurse'].includes(account.login_id)?['note:nursing']:[])] : [];
    const allergyWrites = ['demo.admin','demo.doctor','demo.nurse'].includes(account.login_id) ? ['allergy:write',...(['demo.admin','demo.doctor'].includes(account.login_id)?['allergy:correct']:[])] : [];
    const labWrites = ['demo.admin','demo.doctor'].includes(account.login_id) ? ['lab:order','lab:cancel'] : [];
    await client.query('UPDATE iam.membership SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(privileges || $1::text[]) AS p) WHERE id=$2', [[...grants[account.login_id],...historyReads,...noteWrites,...allergyWrites,...labWrites],account.membership_id]);
  }
  let count=0;
  for (const facility of facilities) {
    for (const [index,given,family,dob,sex] of [[1,'Ada','Adeyemi','1990-01-15','F'],[2,'Daniel','Bello','1982-07-23','M'],[3,'Grace','Okafor','1997-11-08','F']]) {
      const mrn=`LOCAL-UI-${facility.code}-${String(index).padStart(3,'0')}`;
      const system=`urn:pulse:mrn:${facility.id}`;
      let patient=(await client.query('SELECT p.id,p.given_name FROM patient.patient p JOIN patient.identifier i ON i.patient_id=p.id WHERE i.system=$1 AND i.value=$2 AND p.facility_id=$3',[system,mrn,facility.id])).rows[0];
      if (patient) assert.ok(patient.given_name.startsWith('Demo '),'Refusing to change a non-preview record');
      else {
        patient=(await client.query('INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id) VALUES($1,$2,$3,$4,$5) RETURNING id',['Demo '+given,family,dob,sex,facility.id])).rows[0];
        await client.query('INSERT INTO patient.identifier(patient_id,system,value,facility_id) VALUES($1,$2,$3,$4)',[patient.id,system,mrn,facility.id]);
      }
      for (const account of accounts.filter(a=>a.facility_id===facility.id && ['demo.admin','demo.doctor','demo.nurse'].includes(a.login_id))) {
        await client.query("INSERT INTO iam.care_assignment(patient_id,person_id,facility_id,kind) SELECT $1,$2,$3,'local-ui-preview' WHERE NOT EXISTS(SELECT 1 FROM iam.care_assignment WHERE patient_id=$1 AND person_id=$2 AND facility_id=$3 AND kind='local-ui-preview' AND effective_to IS NULL)",[patient.id,account.person_id,facility.id]);
      }
      if(index===1) {
        await client.query("INSERT INTO clin.observation(patient_id,code,value_num,unit,taken_at) SELECT $1,'heart-rate',72,'bpm',now() WHERE NOT EXISTS(SELECT 1 FROM clin.observation WHERE patient_id=$1 AND code='heart-rate')",[patient.id]);
        await client.query("INSERT INTO clin.entry(patient_id,kind,display,status) SELECT $1,'allergy','Demo: Penicillin allergy','active' WHERE NOT EXISTS(SELECT 1 FROM clin.entry WHERE patient_id=$1 AND display='Demo: Penicillin allergy')",[patient.id]);
      }
      count++;
    }
  }
  await client.query('COMMIT');
  console.log(`Verified ${count} explicitly labelled local preview patients and local registration/check-in/vitals/consultation permissions. No unrestricted-care privileges granted.`);
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally {client.release();await db.end();}
