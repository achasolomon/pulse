import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {Pool} from 'pg';
import request from 'supertest';
import {AppModule} from '../src/app.module.js';
import {configureApp} from '../src/platform/bootstrap.js';
import {StaffAuthService} from '../src/modules/iam/application/staff-auth.service.js';
import {STAFF_CRITICAL_REPOSITORY,type StaffCriticalRepository} from '../src/modules/laboratory/domain/staff-critical.repository.js';
describe.skipIf(!process.env.DATABASE_URL)('laboratory duty queue and specimens',()=>{
  let testId:string,foreignPatient:string,foreignEncounter:string,foreignOrder:string;
  const orders:string[]=[];
  let app:INestApplication,db:Pool,org:string,facility:string,foreign:string,patient:string,encounter:string,entryId:string;
  const people={doctor:randomUUID(),other:randomUUID(),reader:randomUUID(),lab:randomUUID(),collector:randomUUID(),receiver:randomUUID()},tokens:Record<string,string>={};
  const base='staff/laboratory';
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
      const privileges=['patient:read','lab:read',...(['lab','collector','receiver'].includes(role)?['lab:worklist',...(role!=='receiver'?['lab:collect']:[]),...(role!=='collector'?['lab:accession']:[])]:role==='doctor'?['encounter:consult','lab:order','lab:cancel']:[])];
      await db.query('INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',[person,org,facility,[role],privileges]);
      if(role==='lab'||role==='receiver')await db.query("UPDATE iam.membership SET privileges=privileges||$2::text[] WHERE person_id=$1",[person,role==='lab'?['lab:result','lab:verify']:['lab:verify']]);
      if(role==='doctor'||role==='other')await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'lab:critical:ack')WHERE person_id=$1",[person]);
      const loginId=`problem-${randomUUID()}`,secret=randomUUID();await auth.register({personId:person,loginId,secret});tokens[role]=(await auth.login({loginId,secret})).token;
      if(!['lab','collector','receiver'].includes(role))await db.query("INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'synthetic-problem-test')",[person,patient,facility,encounter]);
    }
    await db.query("INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,stage,clinician_person_id,checked_in_by)VALUES($1,$2,$3,$4,'in-consultation',$5,$5)",[encounter,org,facility,patient,people.doctor]);
    await db.query("INSERT INTO patient.identifier(patient_id,facility_id,system,value)VALUES($1,$2,$3,'LAB-DUTY-001')",[patient,facility,'urn:pulse:mrn:'+facility]);
    testId=(await db.query("INSERT INTO lab.test(code,name,specimen_requirement,version)VALUES($1,'Synthetic duty test','Synthetic specimen requirement',1)RETURNING id",[randomUUID()])).rows[0].id;
    const created=await db.query("INSERT INTO lab.lab_order(patient_id,encounter_id,test_id,test_version,indication,urgency,created_at)SELECT $1,$2,$3,1,'Synthetic duty indication',CASE WHEN g=1 THEN 'stat' WHEN g=2 THEN 'urgent' ELSE 'routine' END,now()-interval '2 hours'-(g*interval '1 minute') FROM generate_series(1,28)g RETURNING id",[patient,encounter,testId]);orders.push(...created.rows.map(r=>r.id));entryId=orders[0]!;
    foreignPatient=(await db.query("INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic','ForeignDuty','1990-01-15','F',$1)RETURNING id",[foreign])).rows[0].id;
    foreignEncounter=(await db.query("INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",[foreignPatient,foreign])).rows[0].id;
    foreignOrder=(await db.query('INSERT INTO lab.lab_order(patient_id,encounter_id,test_id,test_version,indication)VALUES($1,$2,$3,1,$4)RETURNING id',[foreignPatient,foreignEncounter,testId,'Synthetic foreign duty'])).rows[0].id;
    await db.query('INSERT INTO lab.lab_order(patient_id,encounter_id,test_id,test_version,indication)VALUES($1,$2,$3,1,$4)',[patient,foreignEncounter,testId,'Synthetic inconsistent duty']);
  });
  afterAll(async()=>{
    await app?.close();if(db&&org){
      const patients=[patient,foreignPatient];
      await db.query('DELETE FROM integration.staff_command WHERE organization_id=$1',[org]);
      await db.query("DELETE FROM integration.outbox WHERE aggregate_type='lab_order' AND aggregate_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))",[patients]);
      await db.query('DELETE FROM lab.critical_contact WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.critical_backup WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.critical_case WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.specimen_accession WHERE specimen_id IN(SELECT s.id FROM lab.specimen s JOIN lab.lab_order r ON r.id=s.order_id WHERE r.patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.specimen_identity WHERE specimen_id IN(SELECT s.id FROM lab.specimen s JOIN lab.lab_order r ON r.id=s.order_id WHERE r.patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.specimen WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.result WHERE order_id IN(SELECT id FROM lab.lab_order WHERE patient_id=ANY($1::uuid[]))',[patients]);
      await db.query('DELETE FROM lab.lab_order WHERE patient_id=ANY($1::uuid[])',[patients]);await db.query('DELETE FROM lab.test WHERE id=$1',[testId]);
      await db.query('DELETE FROM iam.care_assignment WHERE patient_id=$1',[patient]);await db.query('DELETE FROM encounter.outpatient_visit WHERE encounter_id=$1',[encounter]);
      await db.query('DELETE FROM encounter.encounter WHERE id=ANY($1::uuid[])',[[encounter,foreignEncounter]]);await db.query('DELETE FROM patient.identifier WHERE patient_id=$1',[patient]);await db.query('DELETE FROM patient.patient WHERE id=ANY($1::uuid[])',[patients]);
      await db.query('DELETE FROM iam.session WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);await db.query('DELETE FROM iam.credential WHERE person_id=ANY($1::uuid[])',[Object.values(people)]);
      await db.query('DELETE FROM iam.membership WHERE organization_id=$1',[org]);await db.query('DELETE FROM org.facility WHERE organization_id=$1',[org]);await db.query('DELETE FROM org.organization WHERE id=$1',[org]);
    }await db?.end();
  });
  const collection=(label='SPEC-DUTY-001')=>({expectedVersion:1,container:'Synthetic container',label,collectedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()});
  it('paginates urgency then age, retains complete stage counts and excludes foreign/inconsistent orders',async()=>{
    const page=(await call('lab',`${base}/queue`).expect(200)).body;expect(page.items).toHaveLength(25);expect(page.counts).toEqual({ordered:28,collected:0,accessioned:0,resulted:0});expect(page.items[0].urgency).toBe('stat');expect(page.items[1].urgency).toBe('urgent');
    expect(page.oldestPendingAt).toBeTruthy();const next=(await call('lab',`${base}/queue?cursor=${page.nextCursor}`).expect(200)).body;expect(next.items).toHaveLength(3);expect(new Set([...page.items,...next.items].map(r=>r.id)).size).toBe(28);
    expect((await call('lab',`${base}/queue?q=LAB-DUTY-001`).expect(200)).body.counts.ordered).toBe(28);
    await call('lab',`${base}/queue?cursor=invalid`).expect(400);await call('lab',`${base}/queue?status=verified`).expect(400);
    await call('lab',`${base}/orders/${foreignOrder}`).expect(404);await call('lab',`${base}/queue`,undefined,foreign).expect(403);
  });
  it('grants minimum laboratory duty access without granting care/chart access',async()=>{
    const duty=(await call('lab',`${base}/orders/${entryId}`).expect(200)).body;expect(duty.patient.mrn).toBe('LAB-DUTY-001');expect(duty.specimens).toEqual([]);
    await call('lab',`staff/charts/${patient}`).expect(403);await call('doctor',`${base}/queue`).expect(403);await call('reader',`${base}/orders/${entryId}`).expect(403);
    await call('receiver',`${base}/orders/${entryId}/collect`,collection()).expect(403);
  });
  it('validates identity attestation, actor attribution, labels and actual times',async()=>{
    await call('lab',`${base}/orders/${entryId}/collect`,{...collection(),identityConfirmed:false}).expect(400);
    await call('lab',`${base}/orders/${entryId}/collect`,{...collection(),collectedBy:people.other}).expect(400);
    await call('lab',`${base}/orders/${entryId}/collect`,{...collection(),collectedAt:new Date(Date.now()+86400000).toISOString()}).expect(400);
    await call('lab',`${base}/orders/${entryId}/collect`,{...collection(),collectedAt:'1990-01-01T00:00:00Z'}).expect(400);
    await call('lab',`${base}/orders/${entryId}/collect`,{...collection(),label:'bad label\n'}).expect(400);
  });
  it('collects once under retries, preserving actor/time and rejecting stale competing steps',async()=>{
    const input=collection();const replies=await Promise.all([call('lab',`${base}/orders/${entryId}/collect`,input),call('lab',`${base}/orders/${entryId}/collect`,input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);
    expect(replies[0].body).toMatchObject({status:'collected',version:2});expect(replies[0].body.specimens).toHaveLength(1);expect(replies[0].body.specimens[0]).toMatchObject({collectedBy:people.lab,identityConfirmed:true,label:input.label,container:input.container});
    await expect(db.query("UPDATE lab.specimen SET label='REPLACED' WHERE order_id=$1",[entryId])).rejects.toMatchObject({code:'23514'});
    await call('collector',`${base}/orders/${entryId}/collect`,collection('OTHER-LABEL')).expect(409);
    await call('lab',`${base}/orders/${orders[1]}/collect`,collection('spec-duty-001')).expect(409);
    expect((await call('lab',`${base}/orders/${orders[1]}`).expect(200)).body.specimens).toEqual([]);
  });
  it('requires the matching specimen and separate accession capability; attributes receipt idempotently',async()=>{
    const duty=(await call('lab',`${base}/orders/${entryId}`).expect(200)).body;
    const input={expectedVersion:2,specimenId:duty.specimens[0].id,accessionNumber:'ACC-DUTY-001',receivedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()};
    await call('collector',`${base}/orders/${entryId}/accession`,input).expect(403);
    await call('receiver',`${base}/orders/${entryId}/accession`,{...input,specimenId:randomUUID()}).expect(409);
    await call('receiver',`${base}/orders/${entryId}/accession`,{...input,receivedAt:'1990-01-01T00:00:00Z'}).expect(400);
    const result=(await call('receiver',`${base}/orders/${entryId}/accession`,input).expect(201)).body;expect(result).toMatchObject({status:'accessioned',version:3});expect(result.specimens[0].accession).toMatchObject({number:input.accessionNumber,receivedBy:people.receiver});expect(result.specimens[0].collectedBy).toBe(people.lab);
    expect((await call('receiver',`${base}/orders/${entryId}/accession`,input).expect(201)).body.specimens[0].accession.number).toBe(input.accessionNumber);
    await expect(db.query("UPDATE lab.specimen_accession SET accession_number='REPLACED' WHERE specimen_id=$1",[input.specimenId])).rejects.toMatchObject({code:'23514'});
  });
  it('stages attributed revisions idempotently, withholding findings until independent verification',async()=>{
    const input={expectedVersion:3,commandKey:randomUUID(),component:'Synthetic component',value:'Synthetic value',unit:'unit',flag:null,effectiveAt:new Date().toISOString(),attestation:true};
    await call('collector',`${base}/orders/${entryId}/results`,input).expect(403);
    await call('lab',`${base}/orders/${foreignOrder}/results`,input).expect(404);
    await call('lab',`${base}/orders/${entryId}/results`,{...input,attestation:false}).expect(400);
    await call('lab',`${base}/orders/${entryId}/results`,{...input,recordedBy:people.other}).expect(400);
    await call('lab',`${base}/orders/${entryId}/results`,{...input,effectiveAt:'1990-01-01T00:00:00Z'}).expect(400);
    const replies=await Promise.all([call('lab',`${base}/orders/${entryId}/results`,input),call('lab',`${base}/orders/${entryId}/results`,input)]);
    expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body).toMatchObject({status:'resulted',version:4});
    expect(replies[0].body.results).toMatchObject([{component:input.component,value:input.value,version:1,recordedBy:people.lab,source:'manual-bench',flag:null}]);
    const chart=()=>call('doctor',`staff/charts/${patient}/history/investigations`);
    expect(JSON.stringify((await chart().expect(200)).body)).not.toContain(input.value);
    await call('lab',`${base}/orders/${entryId}/results`,{...input,commandKey:randomUUID()}).expect(409);
    const revised=(await call('lab',`${base}/orders/${entryId}/results`,{...input,component:'synthetic COMPONENT',expectedVersion:4,value:'Revised synthetic value',commandKey:randomUUID()}).expect(201)).body;
    expect(revised.results).toHaveLength(1);expect(revised.results[0]).toMatchObject({version:2,component:input.component});
    expect((await db.query('SELECT count(*)::int AS n FROM lab.result WHERE order_id=$1',[entryId])).rows[0].n).toBe(2);
    await expect(db.query("UPDATE lab.result SET value_text='overwrite' WHERE order_id=$1",[entryId])).rejects.toMatchObject({code:'23514'});
    const verification={expectedVersion:5,commandKey:randomUUID(),attestation:true};
    await call('lab',`${base}/orders/${entryId}/verify`,verification).expect(403);
    await call('collector',`${base}/orders/${entryId}/verify`,verification).expect(403);
    await call('receiver',`${base}/orders/${entryId}/verify`,{...verification,expectedVersion:4}).expect(409);
    const final=(await call('receiver',`${base}/orders/${entryId}/verify`,verification).expect(201)).body;
    expect(final).toMatchObject({status:'verified',version:6,verification:{by:people.receiver}});
    await call('receiver',`${base}/orders/${entryId}/verify`,verification).expect(201);
    expect(JSON.stringify((await chart().expect(200)).body)).toContain('Revised synthetic value');
    await call('lab',`${base}/orders/${entryId}/results`,{...input,expectedVersion:6,commandKey:randomUUID()}).expect(409);
    await expect(db.query("INSERT INTO lab.result(order_id,component,value_text)VALUES($1,'extra','forbidden')",[entryId])).rejects.toMatchObject({code:'23514'});
    expect((await call('collector',`${base}/orders/${entryId}`).expect(200)).body.results).toBeUndefined();
  });
  it('holds critical findings from publication and rejects empty report verification',async()=>{
    const id=orders[7]!;
    await call('receiver',`${base}/orders/${id}/verify`,{expectedVersion:1,commandKey:randomUUID(),attestation:true}).expect(409);
    const collected=(await call('lab',`${base}/orders/${id}/collect`,collection('SPEC-CRITICAL')).expect(201)).body;
    await call('receiver',`${base}/orders/${id}/accession`,{expectedVersion:2,specimenId:collected.specimens[0].id,accessionNumber:'ACC-CRITICAL',receivedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()}).expect(201);
    await call('lab',`${base}/orders/${id}/results`,{expectedVersion:3,commandKey:randomUUID(),component:'Synthetic critical',value:'Synthetic critical value',unit:'',flag:'critical',effectiveAt:new Date().toISOString(),attestation:true}).expect(201);
    const held=await call('receiver',`${base}/orders/${id}/verify`,{expectedVersion:4,commandKey:randomUUID(),attestation:true}).expect(409);
    expect(held.body.code).toBe('LAB_CRITICAL_RELEASE_HELD');
    expect((await call('receiver',`${base}/orders/${id}`).expect(200)).body.status).toBe('resulted');
    const audit=(await db.query('SELECT metadata FROM audit.audit_event WHERE tenant_id=$1',[org])).rows;
    expect(JSON.stringify(audit)).not.toContain('Synthetic critical value');
  });
  it('routes a pinned confirmed critical finding, records read-back, and requires explicit named clinician acknowledgement',async()=>{
    const id=orders[7]!,critical='staff/critical-results';
    expect((await call('doctor',`${critical}/count`).expect(200)).body.pending).toBe(0);
    const candidates=(await call('receiver',`${critical}/orders/${id}/recipients`).expect(200)).body;
    expect(candidates.map(r=>r.id)).toContain(people.doctor);expect(candidates.map(r=>r.id)).not.toContain(people.lab);
    const input={expectedVersion:4,recipientId:people.doctor,dueAt:new Date(Date.now()+3600000).toISOString(),attestation:true,commandKey:randomUUID()};
    await call('lab',`${critical}/orders/${id}/notify`,input).expect(403);
    await call('receiver',`${critical}/orders/${foreignOrder}/notify`,input).expect(404);
    await call('receiver',`${critical}/orders/${id}/notify`,{...input,recipientId:people.collector}).expect(400);
    await call('receiver',`${critical}/orders/${id}/notify`,{...input,expectedVersion:3}).expect(409);
    await call('receiver',`${critical}/orders/${id}/notify`,{...input,attestation:false}).expect(400);
    const notified=(await call('receiver',`${critical}/orders/${id}/notify`,input).expect(201)).body;
    expect(notified.case).toMatchObject({recipientId:people.doctor,confirmedBy:people.receiver,version:1});
    await call('receiver',`${critical}/orders/${id}/notify`,input).expect(201);
    expect((await call('doctor',`${critical}/count`).expect(200)).body).toEqual({pending:1,overdue:0});
    expect((await call('other',`${critical}/count`).expect(200)).body.pending).toBe(0);
    await call('other',`${critical}/orders/${id}`).expect(404);
    const clinicianView=(await call('doctor',`${critical}/orders/${id}`).expect(200)).body;
    expect(clinicianView.results[0].flag).toBe('critical');expect(clinicianView.canAcknowledge).toBe(true);
    expect((await call('receiver',`${critical}/orders/${id}`).expect(200)).body.canAcknowledge).toBe(false);
    expect((await call('doctor',`${critical}`).expect(200)).body.items[0].patient.id).toBe(patient);
    expect((await call('doctor',`${critical}/count`).expect(200)).body.pending).toBe(1); // Opening is not acknowledgement.
    await call('doctor',`${critical}?cursor=bad`).expect(400);
    const ack={expectedVersion:1,attestation:true,commandKey:randomUUID()};
    await call('other',`${critical}/orders/${id}/acknowledge`,ack).expect(404);
    await call('doctor',`${critical}/orders/${id}/acknowledge`,ack).expect(409);
    await call('lab',`${base}/orders/${id}/results`,{expectedVersion:4,component:'Synthetic critical',value:'Changed',unit:'',flag:null,effectiveAt:new Date().toISOString(),attestation:true,commandKey:randomUUID()}).expect(409);
    const contact={expectedVersion:1,channel:'phone',outcome:'unreachable',readBack:false,occurredAt:new Date().toISOString(),commandKey:randomUUID()};
    await call('receiver',`${critical}/orders/${id}/attempt`,{...contact,actorId:people.doctor}).expect(400);
    await call('receiver',`${critical}/orders/${id}/attempt`,{...contact,occurredAt:'1990-01-01T00:00:00Z'}).expect(400);
    await call('receiver',`${critical}/orders/${id}/attempt`,contact).expect(201);
    await call('receiver',`${critical}/orders/${id}/attempt`,contact).expect(201);
    expect((await call('doctor',`${critical}/count`).expect(200)).body.pending).toBe(1);
    await call('receiver',`${critical}/orders/${id}/attempt`,{...contact,expectedVersion:2,outcome:'reached',commandKey:randomUUID()}).expect(400);
    const reached=(await call('receiver',`${critical}/orders/${id}/attempt`,{...contact,expectedVersion:2,outcome:'reached',readBack:true,occurredAt:new Date().toISOString(),commandKey:randomUUID()}).expect(201)).body;
    expect(reached.contacts).toHaveLength(2);expect(reached.contacts[1].actorId).toBe(people.receiver);
    await expect(db.query("UPDATE lab.critical_contact SET outcome='unreachable' WHERE order_id=$1",[id])).rejects.toMatchObject({code:'23514'});
    await db.query("UPDATE encounter.encounter SET status='discharged',ended_at=now()WHERE id=$1",[encounter]);
    expect((await call('doctor',`${critical}/count`).expect(200)).body.pending).toBe(1);
    await db.query('UPDATE iam.care_assignment SET effective_to=now()WHERE person_id=$1 AND patient_id=$2',[people.doctor,patient]);
    await call('doctor',`${critical}/orders/${id}/acknowledge`,{...ack,expectedVersion:3}).expect(403);
    await db.query('UPDATE iam.care_assignment SET effective_to=NULL WHERE person_id=$1 AND patient_id=$2',[people.doctor,patient]);
    const finalAck={...ack,expectedVersion:3,commandKey:randomUUID()};
    const acknowledged=(await call('doctor',`${critical}/orders/${id}/acknowledge`,finalAck).expect(201)).body;
    expect(acknowledged.case).toMatchObject({acknowledgedBy:people.doctor,version:4});
    await call('doctor',`${critical}/orders/${id}/acknowledge`,finalAck).expect(201);
    await expect(db.query('UPDATE lab.critical_case SET recipient_id=$2 WHERE order_id=$1',[id,people.other])).rejects.toMatchObject({code:'23514'});

    await expect(db.query('UPDATE lab.critical_case SET acknowledged_by=NULL,acknowledged_at=NULL WHERE order_id=$1',[id])).rejects.toMatchObject({code:'23514'});
    expect((await call('doctor',`${critical}/count`).expect(200)).body.pending).toBe(0);
    const final=(await call('receiver',`${base}/orders/${id}/verify`,{expectedVersion:4,attestation:true,commandKey:randomUUID()}).expect(201)).body;expect(final.status).toBe('verified');
    const chart=(await call('doctor',`staff/charts/${patient}/history/investigations`).expect(200)).body;
    expect(chart.items.find(item=>item.id===id).fields.find(f=>f.label==='Critical communication').value).toContain('Acknowledged');
    await db.query("UPDATE encounter.encounter SET status='open',ended_at=NULL WHERE id=$1",[encounter]);
    const events=(await db.query("SELECT payload FROM integration.outbox WHERE aggregate_id=$1",[id])).rows;expect(JSON.stringify(events)).not.toContain('Synthetic critical value');
  });
  async function criticalCase(index:number,dueMs=60000){
    const id=orders[index]!;
    const specimen=(await call('lab',`${base}/orders/${id}/collect`,collection('SPEC-BACKUP-'+index)).expect(201)).body.specimens[0];
    await call('receiver',`${base}/orders/${id}/accession`,{expectedVersion:2,specimenId:specimen.id,accessionNumber:'ACC-BACKUP-'+index,receivedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()}).expect(201);
    await call('lab',`${base}/orders/${id}/results`,{expectedVersion:3,commandKey:randomUUID(),component:'Synthetic backup finding',value:'Synthetic critical source',unit:'',flag:'critical',effectiveAt:new Date().toISOString(),attestation:true}).expect(201);
    await call('receiver',`staff/critical-results/orders/${id}/notify`,{expectedVersion:4,commandKey:randomUUID(),recipientId:people.doctor,dueAt:new Date(Date.now()+dueMs).toISOString(),attestation:true}).expect(201);return id;
  }
  const routing=(mode='at-deadline')=>({expectedVersion:1,commandKey:randomUUID(),recipientId:people.other,mode,reason:'Synthetic covering responsibility',attestation:true});
  it('activates a scheduled covering clinician exactly once and requires their own contact/read-back',async()=>{
    const id=await criticalCase(10,1500),path=`staff/critical-results/orders/${id}`,repo=app.get<StaffCriticalRepository>(STAFF_CRITICAL_REPOSITORY),input=routing();
    await call('collector',`${path}/backup`,input).expect(403);await call('receiver',`${path}/backup`,{...input,recipientId:people.lab}).expect(400);
    const scheduled=(await call('receiver',`${path}/backup`,input).expect(201)).body;expect(scheduled.backups[0].status).toBe('scheduled');expect(scheduled.case).toMatchObject({recipientId:people.doctor,version:2});
    await call('receiver',`${path}/backup`,input).expect(201);expect((await call('other','staff/critical-results/count').expect(200)).body.pending).toBe(0);
    await db.query('SELECT pg_sleep(1.6)');const counts=await Promise.all([repo.processDue(),repo.processDue()]);expect(counts.reduce((a,b)=>a+b,0)).toBe(1);
    const active=(await call('other',path).expect(200)).body;expect(active.backups[0].status).toBe('active');expect(active.canAcknowledge).toBe(true);expect(active.readBackConfirmed).toBe(false);expect(active.case).toMatchObject({recipientId:people.doctor,version:3});
    const ack=(version:number)=>({expectedVersion:version,attestation:true,commandKey:randomUUID()});
    await call('other',`${path}/acknowledge`,ack(3)).expect(409);
    const contact=(version:number,recipientId:string)=>({expectedVersion:version,recipientId,channel:'phone',outcome:'reached',readBack:true,occurredAt:new Date().toISOString(),commandKey:randomUUID()});
    await call('receiver',`${path}/attempt`,contact(3,people.doctor)).expect(201);await call('other',`${path}/acknowledge`,ack(4)).expect(409);
    await call('receiver',`${path}/attempt`,contact(4,people.other)).expect(201);
    const accepted=(await call('other',`${path}/acknowledge`,ack(5)).expect(201)).body;expect(accepted.case).toMatchObject({recipientId:people.doctor,acknowledgedBy:people.other});
    const events=(await db.query("SELECT payload FROM integration.outbox WHERE aggregate_id=$1 AND type='lab.critical_backup_decided'",[id])).rows;expect(events).toHaveLength(1);expect(JSON.stringify(events)).not.toContain('Synthetic critical source');
    await expect(db.query("UPDATE lab.critical_backup SET reason='overwrite' WHERE order_id=$1",[id])).rejects.toMatchObject({code:'23514'});
  });
  it('cancels scheduled backup activation when the original clinician acknowledges first',async()=>{
    const id=await criticalCase(11),path=`staff/critical-results/orders/${id}`;
    await call('receiver',`${path}/backup`,routing()).expect(201);
    await call('receiver',`${path}/attempt`,{expectedVersion:2,channel:'phone',outcome:'reached',readBack:true,occurredAt:new Date().toISOString(),commandKey:randomUUID()}).expect(201);
    await call('doctor',`${path}/acknowledge`,{expectedVersion:3,attestation:true,commandKey:randomUUID()}).expect(201);
    expect((await call('receiver',path).expect(200)).body.backups[0]).toMatchObject({status:'cancelled',decision:'case-acknowledged'});
    expect(await app.get<StaffCriticalRepository>(STAFF_CRITICAL_REPOSITORY).processDue()).toBe(0);
  });
  it('blocks due routing after recipient access withdrawal, retaining the unresolved original case',async()=>{
    const id=await criticalCase(12,1000),path=`staff/critical-results/orders/${id}`;
    await call('receiver',`${path}/backup`,routing()).expect(201);
    await db.query('UPDATE iam.membership SET effective_to=now()WHERE person_id=$1',[people.other]);
    await db.query('SELECT pg_sleep(1.1)');expect(await app.get<StaffCriticalRepository>(STAFF_CRITICAL_REPOSITORY).processDue()).toBe(1);
    const blocked=(await call('receiver',path).expect(200)).body;expect(blocked.backups[0]).toMatchObject({status:'blocked',decision:'recipient-access-unavailable'});expect(blocked.case.acknowledgedAt).toBeNull();
    await db.query('UPDATE iam.membership SET effective_to=NULL WHERE person_id=$1',[people.other]);await call('other',path).expect(404);
  });
  it('adds immediate cover with review, revision checks and retained original ownership',async()=>{
    const id=await criticalCase(13),path=`staff/critical-results/orders/${id}`,input=routing('immediate');
    await call('receiver',`${path}/backup`,{...input,expectedVersion:2}).expect(409);await call('receiver',`${path}/backup`,{...input,attestation:false}).expect(400);
    const d=(await call('receiver',`${path}/backup`,input).expect(201)).body;expect(d.backups[0].status).toBe('active');expect(d.case.recipientId).toBe(people.doctor);
    await call('receiver',`${path}/backup`,{...input,expectedVersion:2,commandKey:randomUUID()}).expect(409);
    await call('receiver',`${path}/attempt`,{expectedVersion:2,recipientId:people.lab,channel:'phone',outcome:'reached',readBack:true,occurredAt:new Date().toISOString(),commandKey:randomUUID()}).expect(400);
    await expect(db.query('UPDATE lab.critical_case SET recipient_id=$2 WHERE order_id=$1',[id,people.other])).rejects.toMatchObject({code:'23514'});
    for(const [version,recipientId] of [[2,people.doctor],[3,people.other]] as const)await call('receiver',`${path}/attempt`,{expectedVersion:version,recipientId,channel:'phone',outcome:'reached',readBack:true,occurredAt:new Date().toISOString(),commandKey:randomUUID()}).expect(201);
    const replies=await Promise.all(['doctor','other'].map(actor=>call(actor,`${path}/acknowledge`,{expectedVersion:4,attestation:true,commandKey:randomUUID()})));
    expect(replies.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
  });
  it('serializes shared specimen labels and rolls back duplicate accession identifiers',async()=>{
    const label='SPEC-COMPETING';const replies=await Promise.all([call('collector',`${base}/orders/${orders[2]}/collect`,collection(label)),call('collector',`${base}/orders/${orders[3]}/collect`,collection(label))]);expect(replies.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
    const success=replies.find(r=>r.status===201)!.body;const input={expectedVersion:2,specimenId:success.specimens[0].id,accessionNumber:'acc-duty-001',receivedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()};
    await call('receiver',`${base}/orders/${success.id}/accession`,input).expect(409);
    expect((await call('lab',`${base}/orders/${success.id}`).expect(200)).body.status).toBe('collected');
  });
  it('keeps metadata private and permits receipt of a collected specimen after encounter closure',async()=>{
    const collected=(await call('lab',`${base}/queue?status=collected`).expect(200)).body.items[0];expect(collected).toBeTruthy();
    await db.query("UPDATE encounter.encounter SET status='discharged',ended_at=now()WHERE id=$1",[encounter]);
    await call('collector',`${base}/orders/${orders[4]}/collect`,collection('SPEC-CLOSED')).expect(409);
    await call('receiver',`${base}/orders/${collected.id}/accession`,{expectedVersion:collected.version,specimenId:collected.specimens[0].id,accessionNumber:'ACC-AFTER-CLOSURE',receivedAt:new Date().toISOString(),identityConfirmed:true,commandKey:randomUUID()}).expect(201);
    const audit=(await db.query('SELECT metadata FROM audit.audit_event WHERE tenant_id=$1',[org])).rows;expect(JSON.stringify(audit)).not.toContain('Synthetic duty indication');expect(JSON.stringify(audit)).not.toContain('SPEC-DUTY-001');
    const receipts=(await db.query('SELECT result FROM integration.staff_command WHERE organization_id=$1',[org])).rows;expect(JSON.stringify(receipts)).not.toContain('SPEC-DUTY-001');
    const events=(await db.query("SELECT payload FROM integration.outbox WHERE aggregate_type='lab_order' AND aggregate_id=ANY($1::uuid[])",[orders])).rows;expect(JSON.stringify(events)).not.toContain('SPEC-DUTY-001');
  });
  it('revokes duty access immediately after membership or worklist privilege withdrawal',async()=>{
    await db.query('UPDATE iam.membership SET effective_to=now()WHERE person_id=$1',[people.lab]);await call('lab',`${base}/queue`).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'lab:worklist')WHERE person_id=$1",[people.collector]);await call('collector',`${base}/orders/${entryId}`).expect(403);
  });
});
