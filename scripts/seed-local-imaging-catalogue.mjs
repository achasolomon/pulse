// Explicit local preview catalogue. No orders, studies, reports or care assignments.
import assert from 'node:assert/strict';
import {Pool} from 'pg';
assert.equal(process.env.PULSE_SEED_LOCAL_IMAGING,'yes','Explicit preview catalogue opt-in required');
assert.notEqual(process.env.NODE_ENV,'production');
const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5436');assert.equal(url.pathname,'/pulse');
const db=new Pool({connectionString:url.toString()}),c=await db.connect();
try{
  await c.query('BEGIN');const org=(await c.query("SELECT id FROM org.organization WHERE code='LOCAL-ROLE-DEMO'")).rows[0];assert.ok(org,'Local role demo organization required');
  const facilities=(await c.query("SELECT id FROM org.facility WHERE organization_id=$1 AND code IN('LOCAL-CGH','LOCAL-RIVER')",[org.id])).rows;assert.equal(facilities.length,2);
  for(const [code,name,region,side] of [['LOCAL-UI-XR-CHEST','Demo Chest X-ray','chest','na'],['LOCAL-UI-XR-KNEE','Demo Knee X-ray','knee','required']]){
    await c.query("INSERT INTO img.procedure(code,name,modality,body_region,laterality_policy,instructions,version)VALUES($1,$2,'XR',$3,$4,$5,1)ON CONFLICT(code,version)DO NOTHING",[code,name,region,side,'Local UI preview only. Approved protocols, preparation and screening must be configured by radiology before clinical use.']);
    const procedure=(await c.query('SELECT id,name FROM img.procedure WHERE code=$1 AND version=1',[code])).rows[0];assert.equal(procedure.name,name,'Refusing to map a non-preview procedure');
    for(const f of facilities)await c.query('INSERT INTO img.facility_procedure(facility_id,procedure_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[f.id,procedure.id]);
  }
  await c.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges||ARRAY['imaging:view','imaging:order','imaging:cancel'])p)FROM iam.credential cr WHERE cr.person_id=m.person_id AND m.organization_id=$1 AND cr.login_id IN('demo.doctor','demo.admin')",[org.id]);
  await c.query('COMMIT');console.log('Local imaging preview catalogue and doctor/admin request permissions enabled. No clinical records or care assignments created.');
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
