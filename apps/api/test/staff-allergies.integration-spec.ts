import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import {AppModule} from '../src/app.module.js';
import {configureApp} from '../src/platform/bootstrap.js';
import {StaffAuthService} from '../src/modules/iam/application/staff-auth.service.js';
describe.skipIf(!process.env.DATABASE_URL)('staff allergy reconciliation',()=>{
  let app:INestApplication,db:Pool,org:string,facility:string,foreign:string,patient:string,encounter:string,entryId:string;
  const people={doctor:randomUUID(),other:randomUUID(),reader:randomUUID(),nurse:randomUUID()},tokens:Record<string,string>={};
  const base=()=>`staff/patients/${patient}/allergies`;
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
      const privileges=['patient:read','entry:read',...(role==='reader'?[]:['entry:write','allergy:write',...(role==='nurse'?['note:nursing']:['encounter:consult','allergy:correct'])])];
      await db.query('INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',[person,org,facility,[role],privileges]);
      const loginId=`problem-${randomUUID()}`,secret=randomUUID();await auth.register({personId:person,loginId,secret});tokens[role]=(await auth.login({loginId,secret})).token;
      await db.query("INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'synthetic-problem-test')",[person,patient,facility,encounter]);
    }
    await db.query("INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,stage,clinician_person_id,checked_in_by)VALUES($1,$2,$3,$4,'in-consultation',$5,$5)",[encounter,org,facility,patient,people.doctor]);
    await db.query('UPDATE encounter.outpatient_visit SET nurse_person_id=$1 WHERE encounter_id=$2',[people.nurse,encounter]);
  });
  afterAll(async()=>{
    await app?.close();
    if(db&&org){
      await db.query('DELETE FROM integration.staff_command WHERE organization_id=$1',[org]);
      await db.query("DELETE FROM integration.outbox WHERE (aggregate_type='entry' AND aggregate_id IN (SELECT id FROM clin.entry WHERE patient_id=$1)) OR (aggregate_type='allergy_review' AND aggregate_id IN (SELECT id FROM clin.allergy_review WHERE patient_id=$1))",[patient]);
      // Test-only cleanup of this disposable patient's immutable review evidence.
      const cleanup=await db.connect();try{await cleanup.query('BEGIN');await cleanup.query("SET LOCAL session_replication_role='replica'");await cleanup.query('DELETE FROM clin.allergy_review WHERE patient_id=$1',[patient]);await cleanup.query('COMMIT');}catch(e){await cleanup.query('ROLLBACK');throw e;}finally{cleanup.release();}
      await db.query('DELETE FROM clin.allergy_detail WHERE entry_id IN (SELECT id FROM clin.entry WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM clin.entry WHERE patient_id=$1',[patient]);
      await db.query('DELETE FROM iam.care_assignment WHERE patient_id=$1',[patient]);
      await db.query('DELETE FROM encounter.outpatient_visit WHERE encounter_id=$1',[encounter]);
      await db.query('DELETE FROM encounter.encounter WHERE id=$1',[encounter]);
      await db.query('DELETE FROM patient.patient WHERE id=$1',[patient]);
      await db.query('DELETE FROM iam.session WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);
      await db.query('DELETE FROM iam.credential WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);
      await db.query('DELETE FROM iam.membership WHERE organization_id=$1',[org]);
      await db.query('DELETE FROM org.facility WHERE organization_id=$1',[org]);await db.query('DELETE FROM org.organization WHERE id=$1',[org]);
    }await db?.end();
  });
  const read=async(actor='doctor')=>(await call(actor,base()).expect(200)).body;
  const addition=async(actor='doctor')=>({encounterId:encounter,expectedRevision:(await read(actor)).revision,commandKey:randomUUID(),substance:'Synthetic medication',category:'medication',type:'allergy',reaction:'Synthetic recorded reaction',severity:'severe',criticality:'high',informationSource:'patient',verificationStatus:'provisional'});
  const review=async(status='unknown')=>({encounterId:encounter,expectedRevision:(await read()).revision,commandKey:randomUUID(),status,informationSource:'patient',reason:'Synthetic review evidence',attestation:true});
  it('scopes records and encounter ownership, including nursing assignment',async()=>{
    expect((await read()).reviewStatus).toBe('unknown');expect((await read()).latestReview).toBeNull();
    expect((await read()).contexts[0].encounterId).toBe(encounter);
    expect((await read('nurse')).contexts[0].encounterId).toBe(encounter);
    expect((await read('other')).contexts).toEqual([]);
    await call('other',base(),await addition()).expect(403);await call('reader',base(),await addition()).expect(403);
    await call('doctor',base(),undefined,foreign).expect(403);
    await call('doctor',`staff/patients/${randomUUID()}/allergies`).expect(404);
  });
  it('requires an explicit attested review and preserves immutable negative evidence',async()=>{
    const input=await review('no-known-allergies');await call('doctor',`${base()}/review`,{...input,attestation:false}).expect(400);
    const result=await call('doctor',`${base()}/review`,input).expect(201);
    expect(result.body.reviewStatus).toBe('no-known-allergies');expect(result.body.latestReview.reviewedBy).toBe(people.doctor);
    expect((await call('doctor',`${base()}/review`,input).expect(201)).body.latestReview.id).toBe(result.body.latestReview.id);
    await expect(db.query("UPDATE clin.allergy_review SET reason='Replaced' WHERE id=$1",[result.body.latestReview.id])).rejects.toMatchObject({code:'23514'});
    await expect(db.query('DELETE FROM clin.allergy_review WHERE id=$1',[result.body.latestReview.id])).rejects.toMatchObject({code:'23514'});
    const chart=(await call('reader',`staff/charts/${patient}`).expect(200)).body;expect(chart.entries.allergySummary.status).toBe('no-known-allergies');
  });
  it('records nurse-reported reactions once under concurrent retries and supersedes a negative status',async()=>{
    const input=await addition('nurse');const replies=await Promise.all([call('nurse',base(),input),call('nurse',base(),input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);
    const row=replies[0].body.items[0];entryId=row.id;expect(row).toMatchObject({substance:input.substance,recordedBy:people.nurse,reaction:input.reaction,severity:'severe',criticality:'high',verificationStatus:'provisional'});
    expect(replies[0].body.items).toHaveLength(1);expect(replies[0].body.reviewStatus).toBe('allergies-recorded');
    const chart=(await call('reader',`staff/charts/${patient}`).expect(200)).body;expect(chart.entries.allergySummary).toMatchObject({count:1,highCriticality:true,status:'allergies-recorded'});
  });
  it('blocks contradictory declarations, stale lists, duplicates, spoofing and nurse confirmation',async()=>{
    for(const status of ['no-known-allergies','no-known-drug-allergies'])await call('doctor',`${base()}/review`,await review(status)).expect(409);
    await call('doctor',base(),await addition()).expect(409);
    await call('nurse',base(),{...await addition('nurse'),substance:'Other substance',verificationStatus:'confirmed'}).expect(403);
    await call('doctor',base(),{...await addition(),recordedBy:people.other}).expect(400);
    await call('doctor',base(),{...await addition(),expectedRevision:'a'.repeat(64)}).expect(409);
    await call('doctor',base(),{...await addition(),reaction:'   '}).expect(400);
  });
  it('preserves the original entry on attributed correction, keeps status unknown until reviewed again',async()=>{
    const input={encounterId:encounter,expectedRevision:(await read()).revision,commandKey:randomUUID(),reason:'Synthetic mistaken entry correction'};
    await call('nurse',`${base()}/${entryId}/entered-in-error`,input).expect(403);
    const result=await call('doctor',`${base()}/${entryId}/entered-in-error`,input).expect(201);
    expect(result.body.items[0]).toMatchObject({substance:'Synthetic medication',recordedBy:people.nurse,reaction:'Synthetic recorded reaction',status:'resolved',correctedBy:people.doctor,correctionReason:input.reason,version:2});
    expect(result.body.reviewStatus).toBe('unknown');
    const history=(await call('reader',`staff/charts/${patient}/history/entries`).expect(200)).body;expect(history.items[0].status).toBe('entered-in-error');
    expect(history.items[0].fields).toContainEqual({label:'Correction reason',value:input.reason});
    const chart=(await call('reader',`staff/charts/${patient}`).expect(200)).body;expect(chart.entries.allergySummary.status).toBe('unknown');
  });
  it('allows NKDA with a food allergy but treats uncategorised legacy records conservatively and counts beyond recent entries',async()=>{
    await call('doctor',`${base()}/review`,await review('no-known-allergies')).expect(201);
    await call('doctor',base(),{...await addition(),substance:'Synthetic food',category:'food',criticality:'low'}).expect(201);
    await call('doctor',`${base()}/review`,await review('no-known-drug-allergies')).expect(201);
    const legacy=(await db.query("INSERT INTO clin.entry(patient_id,kind,display,origin)VALUES($1,'allergy','Synthetic external unknown','external')RETURNING id",[patient])).rows[0].id;
    await call('doctor',`${base()}/review`,await review('no-known-drug-allergies')).expect(409);
    await call('doctor',`${base()}/${legacy}/entered-in-error`,{encounterId:encounter,expectedRevision:(await read()).revision,commandKey:randomUUID(),reason:'Must not change external source'}).expect(404);
    await db.query("INSERT INTO clin.entry(patient_id,kind,display)SELECT $1,'problem','Synthetic recent problem '||g FROM generate_series(1,55) g",[patient]);
    const chart=(await call('reader',`staff/charts/${patient}`).expect(200)).body;expect(chart.entries.items.some((i:{kind:string})=>i.kind==='allergy')).toBe(false);expect(chart.entries.allergySummary.count).toBe(2);
  });
  it('rejects competing review updates and excludes narratives from evidence receipts',async()=>{
    const input=await review();const replies=await Promise.all([call('doctor',`${base()}/review`,input),call('doctor',`${base()}/review`,{...input,commandKey:randomUUID()})]);expect(replies.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
    const evidence=(await db.query('SELECT metadata FROM audit.audit_event WHERE tenant_id=$1',[org])).rows;expect(JSON.stringify(evidence)).not.toContain('Synthetic recorded reaction');expect(JSON.stringify(evidence)).not.toContain(input.reason);
    const receipts=(await db.query('SELECT result FROM integration.staff_command WHERE organization_id=$1',[org])).rows;expect(JSON.stringify(receipts)).not.toContain(input.reason);
  });
  it('denies writes after encounter closure and reads after care/membership revocation',async()=>{
    const input=await addition();await db.query("UPDATE encounter.encounter SET status='discharged',ended_at=now()WHERE id=$1",[encounter]);await call('doctor',base(),input).expect(403);
    await db.query('UPDATE iam.care_assignment SET effective_to=now() WHERE person_id=$1',[people.doctor]);await call('doctor',base()).expect(404);
    await db.query('UPDATE iam.membership SET effective_to=now() WHERE person_id=$1',[people.nurse]);await call('nurse',base()).expect(403);
  });
});
