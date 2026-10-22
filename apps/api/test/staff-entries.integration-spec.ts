import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import {AppModule} from '../src/app.module.js';
import {configureApp} from '../src/platform/bootstrap.js';
import {StaffAuthService} from '../src/modules/iam/application/staff-auth.service.js';
describe.skipIf(!process.env.DATABASE_URL)('staff problem record',()=>{
  let app:INestApplication,db:Pool,org:string,facility:string,foreign:string,patient:string,encounter:string,entryId:string;
  const people={doctor:randomUUID(),other:randomUUID(),reader:randomUUID()},tokens:Record<string,string>={};
  const base=()=>`staff/patients/${patient}/problems`;
  const body=()=>({encounterId:encounter,kind:'diagnosis',verificationStatus:'provisional',display:'Synthetic documented diagnosis',commandKey:randomUUID()});
  function call(actor:string,path:string,input?:object,fac=facility){const r=request(app.getHttpServer());return (input===undefined?r.get('/api/v1/'+path):r.post('/api/v1/'+path).send(input)).set('Authorization',`Bearer ${tokens[actor]}`).set('x-tenant-id',org).set('x-facility-id',fac);}
  beforeAll(async()=>{
    if(new URL(process.env.DATABASE_URL!).port!=='5437')throw new Error('Disposable port 5437 required');
    db=new Pool({connectionString:process.env.DATABASE_URL});
    org=(await db.query('INSERT INTO org.organization(name,code)VALUES($1,$2)RETURNING id',['Synthetic problems group',randomUUID()])).rows[0].id;
    const fac=async()=> (await db.query('INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',[org,'Synthetic problems hospital',randomUUID()])).rows[0].id;
    facility=await fac();foreign=await fac();
    patient=(await db.query("INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic','Problems','1990-01-15','F',$1)RETURNING id",[facility])).rows[0].id;
    encounter=(await db.query("INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",[patient,facility])).rows[0].id;
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=configureApp(module.createNestApplication());await app.init();const auth=app.get(StaffAuthService);
    for(const [role,person] of Object.entries(people)) {
      const privileges=['patient:read','entry:read',...(role==='reader'?[]:['entry:write','encounter:consult'])];
      await db.query('INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',[person,org,facility,[role],privileges]);
      const loginId=`problem-${randomUUID()}`,secret=randomUUID();await auth.register({personId:person,loginId,secret});tokens[role]=(await auth.login({loginId,secret})).token;
      await db.query("INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'synthetic-problem-test')",[person,patient,facility,encounter]);
    }
    await db.query("INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,stage,clinician_person_id,checked_in_by)VALUES($1,$2,$3,$4,'in-consultation',$5,$5)",[encounter,org,facility,patient,people.doctor]);
  });
  afterAll(async()=>{
    await app?.close();
    if(db&&org){
      await db.query('DELETE FROM integration.staff_command WHERE organization_id=$1',[org]);
      await db.query("DELETE FROM integration.outbox WHERE aggregate_type='entry' AND aggregate_id IN (SELECT id FROM clin.entry WHERE patient_id=$1)",[patient]);
      await db.query('DELETE FROM clin.entry WHERE patient_id=$1',[patient]);
      await db.query('DELETE FROM iam.care_assignment WHERE patient_id=$1',[patient]);
      await db.query('DELETE FROM encounter.outpatient_visit WHERE encounter_id=$1',[encounter]);
      await db.query('DELETE FROM encounter.encounter WHERE id=$1',[encounter]);
      await db.query('DELETE FROM patient.patient WHERE id=$1',[patient]);
      await db.query('DELETE FROM iam.session WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);
      await db.query('DELETE FROM iam.credential WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);
      await db.query('DELETE FROM iam.membership WHERE organization_id=$1',[org]);
      await db.query('DELETE FROM org.facility WHERE organization_id=$1',[org]);await db.query('DELETE FROM org.organization WHERE id=$1',[org]);
    }
    await db?.end();
  });
  it('offers only owned active contexts and rejects patient-care-only staff and foreign scope',async()=>{
    expect((await call('doctor',`staff/patients/${patient}/problem-contexts`).expect(200)).body[0].encounterId).toBe(encounter);
    expect((await call('other',`staff/patients/${patient}/problem-contexts`).expect(200)).body).toEqual([]);
    await call('other',base(),body()).expect(403);await call('reader',base(),body()).expect(403);
    await call('doctor',base(),body(),foreign).expect(403);
    await call('doctor',base(),{...body(),encounterId:randomUUID()}).expect(403);
  });
  it('validates classification and rejects author spoofing or implicit confirmation',async()=>{
    await call('doctor',base(),{...body(),kind:'allergy'}).expect(400);
    await call('doctor',base(),{...body(),verificationStatus:undefined}).expect(400);
    await call('doctor',base(),{...body(),recordedBy:people.other}).expect(400);
    await call('doctor',base(),{...body(),display:'   '}).expect(400);
  });
  it('creates one attributed uncoded entry under concurrent retries and rejects duplicates',async()=>{
    const input=body();const replies=await Promise.all([call('doctor',base(),input),call('doctor',base(),input)]);
    expect(replies.map(r=>r.status)).toEqual([201,201]);entryId=replies[0].body.id;expect(replies[1].body.id).toBe(entryId);
    expect(replies[0].body).toMatchObject({recordedBy:people.doctor,status:'active',version:1,verificationStatus:'provisional',code:null});
    await call('doctor',base(),body()).expect(409);
    await call('doctor',base(),{...input,display:'Different text'}).expect(409);
    const audit=(await db.query('SELECT metadata FROM audit.audit_event WHERE resource_id=$1',[entryId])).rows;
    expect(JSON.stringify(audit)).not.toContain(input.display);
    const receipts=(await db.query('SELECT result FROM integration.staff_command WHERE organization_id=$1',[org])).rows;
    expect(JSON.stringify(receipts)).not.toContain(input.display);
  });
  it('scopes reads and leaves legacy verification unknown',async()=>{
    const row=(await call('reader',`${base()}/${entryId}`).expect(200)).body;expect(row.display).toBe(body().display);
    await call('doctor',`staff/patients/${randomUUID()}/problems/${entryId}`).expect(404);
    const legacy=(await db.query("INSERT INTO clin.entry(patient_id,kind,display)VALUES($1,'problem','Synthetic legacy problem')RETURNING id",[patient])).rows[0].id;
    expect((await call('reader',`${base()}/${legacy}`).expect(200)).body.verificationStatus).toBeNull();
    const external=(await db.query("INSERT INTO clin.entry(patient_id,kind,display,origin)VALUES($1,'problem','Synthetic external problem','external')RETURNING id",[patient])).rows[0].id;
    await call('doctor',`${base()}/${external}/resolve`,{encounterId:encounter,expectedVersion:1,reason:'Reviewed elsewhere',commandKey:randomUUID()}).expect(404);
  });
  it('resolves once with version conflict protection and retains the original description and author',async()=>{
    const input={encounterId:encounter,expectedVersion:1,reason:'Synthetic clinical resolution reason',commandKey:randomUUID()};
    await call('doctor',`${base()}/${entryId}/resolve`,{...input,expectedVersion:7}).expect(409);
    const replies=await Promise.all([call('doctor',`${base()}/${entryId}/resolve`,input),call('doctor',`${base()}/${entryId}/resolve`,{...input,commandKey:randomUUID()})]);
    expect(replies.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
    const entry=(await call('reader',`${base()}/${entryId}`).expect(200)).body;
    expect(entry).toMatchObject({display:body().display,recordedBy:people.doctor,resolvedBy:people.doctor,status:'resolved',version:2,resolutionReason:input.reason,resolutionEncounterId:encounter});
    expect(entry.resolvedAt).toBeTruthy();
    const history=await call('reader',`staff/charts/${patient}/history/entries`).expect(200);
    expect(history.body.items.find((r:{id:string})=>r.id===entryId).fields).toContainEqual({label:'Resolution reason',value:input.reason});
  });
  it('rejects legacy bypass and writes after closure or revoked care/membership',async()=>{
    await call('doctor','clinical/entries',{patientId:patient,encounterId:encounter,kind:'diagnosis',display:'Bypass'}).expect(409);
    await db.query("UPDATE encounter.encounter SET status='discharged',ended_at=now() WHERE id=$1",[encounter]);
    await call('doctor',base(),{...body(),display:'After closure'}).expect(403);
    await db.query("UPDATE encounter.encounter SET status='open',ended_at=NULL WHERE id=$1",[encounter]);
    await db.query('UPDATE iam.care_assignment SET effective_to=now() WHERE person_id=$1',[people.doctor]);
    await call('doctor',base(),body()).expect(403);await call('doctor',`${base()}/${entryId}`).expect(404);
    await db.query('UPDATE iam.membership SET effective_to=now() WHERE person_id=$1',[people.reader]);
    await call('reader',`${base()}/${entryId}`).expect(403);
  });
});
