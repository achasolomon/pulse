// Explicitly labelled local preview catalogue; creates no orders or clinical records.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
assert.equal(process.env.PULSE_SEED_LOCAL_LAB,'yes','Explicit local catalogue opt-in required');
assert.notEqual(process.env.NODE_ENV,'production');
const url=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5436');assert.equal(url.pathname,'/pulse');
const db=new Pool({connectionString:url.toString()}),client=await db.connect();
try{
  await client.query('BEGIN');
  const org=(await client.query("SELECT id FROM org.organization WHERE code='LOCAL-ROLE-DEMO'")).rows[0];assert.ok(org,'Local role demo organization required');
  const facilities=(await client.query("SELECT id FROM org.facility WHERE organization_id=$1 AND code IN ('LOCAL-CGH','LOCAL-RIVER')",[org.id])).rows;assert.equal(facilities.length,2);
  for(const [code,name] of [['LOCAL-UI-FBC','Demo Full blood count'],['LOCAL-UI-URINE','Demo Urinalysis']]){
    await client.query('INSERT INTO lab.test(code,name,specimen_requirement,version)VALUES($1,$2,$3,1)ON CONFLICT(code,version)DO NOTHING',[code,name,'Demo specimen requirement only. Configure approved collection instructions before clinical use.']);
    const test=(await client.query('SELECT id,name FROM lab.test WHERE code=$1 AND version=1',[code])).rows[0];assert.equal(test.name,name,'Refusing to map a non-preview catalogue entry');
    for(const facility of facilities)await client.query('INSERT INTO lab.facility_test(facility_id,test_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[facility.id,test.id]);
  }
  await client.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges || ARRAY['lab:read','lab:order','lab:cancel']) p) FROM iam.credential c WHERE c.person_id=m.person_id AND m.organization_id=$1 AND c.login_id IN ('demo.doctor','demo.admin')",[org.id]);
  await client.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges || ARRAY['patient:read','lab:read','lab:worklist','lab:collect','lab:accession']) p) FROM iam.credential c WHERE c.person_id=m.person_id AND m.organization_id=$1 AND c.login_id='demo.lab' AND 'lab_technician'=ANY(m.roles)",[org.id]);
  await client.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges || ARRAY['lab:result']) p) FROM iam.credential c WHERE c.person_id=m.person_id AND m.organization_id=$1 AND c.login_id='demo.lab' AND 'lab_technician'=ANY(m.roles)",[org.id]);
  await client.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges || ARRAY['patient:read','lab:read','lab:worklist','lab:verify']) p) FROM iam.credential c WHERE c.person_id=m.person_id AND m.organization_id=$1 AND c.login_id='demo.admin'",[org.id]);
  await client.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges || ARRAY['lab:critical:ack']) p) FROM iam.credential c WHERE c.person_id=m.person_id AND m.organization_id=$1 AND c.login_id='demo.doctor'",[org.id]);
  await client.query('COMMIT');console.log('Local lab demo enabled: demo.lab result entry, demo.admin independent verification/critical communication, demo.doctor named critical acknowledgement with current care. No clinical records or care assignments created.');
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await db.end();}
