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
    const checks=[{key:'identity',label:'Patient identity and requested procedure / side reviewed',allowNotApplicable:false},{key:'policy',label:'Applicable facility screening and preparation requirements reviewed',allowNotApplicable:false}];
    await c.query("INSERT INTO img.protocol_template(code,name,procedure_id,version,instructions,policy_reference,checks)VALUES($1,$2,$3,1,$4,$5,$6::jsonb)ON CONFLICT(code,version)DO NOTHING",[code+'-PROTOCOL','Demo '+region+' planning review',procedure.id,'DEMONSTRATION ONLY. Replace with radiology-approved technique, preparation and procedure-specific screening before clinical use.','LOCAL PREVIEW — not an approved clinical policy',JSON.stringify(checks)]);
    const protocol=(await c.query('SELECT id,procedure_id FROM img.protocol_template WHERE code=$1 AND version=1',[code+'-PROTOCOL'])).rows[0];assert.equal(protocol.procedure_id,procedure.id);
    for(const f of facilities)await c.query('INSERT INTO img.facility_protocol(facility_id,template_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[f.id,protocol.id]);
    await c.query("INSERT INTO img.acquisition_template(code,name,procedure_id,version,dicom_modality,instructions,policy_reference,checks)VALUES($1,$2,$3,1,'DX',$4,$5,$6::jsonb)ON CONFLICT(code,version)DO NOTHING",[code+'-ACQUISITION','Demo '+region+' procedure-day checks',procedure.id,'DEMONSTRATION ONLY. Resolve actual procedure-day screening, preparation, technique and authorisation through approved radiology policy before clinical use.','LOCAL PREVIEW - not an approved clinical policy',JSON.stringify([{key:'identity-side',label:'Patient, procedure and requested side verified at acquisition',allowNotApplicable:false},{key:'day-policy',label:'Applicable procedure-day screening, preparation and authorisation resolved',allowNotApplicable:false}])]);
    const acquisition=(await c.query('SELECT id,procedure_id FROM img.acquisition_template WHERE code=$1 AND version=1',[code+'-ACQUISITION'])).rows[0];assert.equal(acquisition.procedure_id,procedure.id);
    for(const f of facilities)await c.query('INSERT INTO img.facility_acquisition_template(facility_id,template_id)VALUES($1,$2)ON CONFLICT DO NOTHING',[f.id,acquisition.id]);
  }
  await c.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges||ARRAY['imaging:view','imaging:order','imaging:cancel'])p)FROM iam.credential cr WHERE cr.person_id=m.person_id AND m.organization_id=$1 AND cr.login_id IN('demo.doctor','demo.admin')",[org.id]);
  for(const f of facilities){
    await c.query("INSERT INTO img.schedule_resource(facility_id,code,name,modality,location)VALUES($1,'LOCAL-UI-XR','Demo X-ray room','XR','Local preview imaging department')ON CONFLICT(facility_id,code)DO NOTHING",[f.id]);
    const resource=(await c.query("SELECT id,name FROM img.schedule_resource WHERE facility_id=$1 AND code='LOCAL-UI-XR'",[f.id])).rows[0];assert.equal(resource.name,'Demo X-ray room');
    const procedures=(await c.query("SELECT id FROM img.procedure WHERE code IN('LOCAL-UI-XR-CHEST','LOCAL-UI-XR-KNEE') AND version=1 ORDER BY code")).rows;
    for(let day=0;day<4;day++)for(let slot=0;slot<8;slot++){
      const start=new Date();start.setUTCDate(start.getUTCDate()+day);start.setUTCHours(9+Math.floor(slot/2),slot%2*30,0,0);
      if(start.getTime()<=Date.now())continue;
      await c.query('INSERT INTO img.schedule_slot(resource_id,procedure_id,starts_at,ends_at) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM img.schedule_slot WHERE resource_id=$1 AND starts_at=$3::timestamptz)ON CONFLICT(resource_id,starts_at)DO NOTHING',[resource.id,procedures[slot%procedures.length].id,start,new Date(start.getTime()+30*60000)]);
    }
  }
  await c.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges||ARRAY['patient:read','imaging:view','imaging:worklist','imaging:protocol','imaging:schedule','imaging:reschedule','imaging:appointment:cancel','imaging:arrival','imaging:no-show','imaging:acquire','imaging:report','imaging:finalize','imaging:communicate'])p)FROM iam.credential cr WHERE cr.person_id=m.person_id AND m.organization_id=$1 AND cr.login_id IN('demo.radiology','demo.admin')",[org.id]);
  await c.query("UPDATE iam.membership m SET privileges=ARRAY(SELECT DISTINCT p FROM unnest(m.privileges||ARRAY['imaging:view','imaging:acknowledge'])p)FROM iam.credential cr WHERE cr.person_id=m.person_id AND m.organization_id=$1 AND cr.login_id IN('demo.doctor','demo.admin')",[org.id]);
  await c.query('COMMIT');console.log('Local imaging preview catalogue, doctor/admin request permissions and radiology/admin duty reads enabled. No clinical records or care assignments created.');
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
