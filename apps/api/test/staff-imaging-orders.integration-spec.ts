import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
import {PACS_GATEWAY,type PacsStudyBinding} from '../src/modules/imaging/domain/pacs.gateway.js';
const verifyStudy=vi.fn(async(binding:PacsStudyBinding)=>({verified:true as const,studyUid:binding.studyUid,seriesCount:1,instanceCount:3,checkedAt:new Date().toISOString()}));
describe.skipIf(!process.env.DATABASE_URL)('staff imaging requests', () => {
  const procedureIds: string[] = [];
  const resourceIds:string[]=[];let scheduleSlot:string,secondSlot:string,bookedOrder:string;
  const protocolIds:string[]=[];let protocolOrder:string,protocolId:string;
  const code = 'SYN-IMG-' + randomUUID();
  let procedureId: string, unmapped: string, inactive: string, newTest: string;
  let app: INestApplication,
    db: Pool,
    org: string,
    facility: string,
    foreign: string,
    patient: string,
    encounter: string,
    entryId: string;
  const people = {
      doctor: randomUUID(),
      other: randomUUID(),
      reader: randomUUID(),
    },
    tokens: Record<string, string> = {};
  const base = () => `staff/patients/${patient}/imaging`;
  function call(actor: string, path: string, input?: object, fac = facility) {
    const r = request(app.getHttpServer());
    return (
      input === undefined
        ? r.get('/api/v1/' + path)
        : r.post('/api/v1/' + path).send(input)
    )
      .set('Authorization', `Bearer ${tokens[actor]}`)
      .set('x-tenant-id', org)
      .set('x-facility-id', fac);
  }
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).port !== '5437')
      throw new Error('Disposable port 5437 required');
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    org = (
      await db.query(
        'INSERT INTO org.organization(name,code)VALUES($1,$2)RETURNING id',
        ['Synthetic problems group', randomUUID()],
      )
    ).rows[0].id;
    const fac = async () =>
      (
        await db.query(
          'INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',
          [org, 'Synthetic problems hospital', randomUUID()],
        )
      ).rows[0].id;
    facility = await fac();
    foreign = await fac();
    patient = (
      await db.query(
        "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic','Problems','1990-01-15','F',$1)RETURNING id",
        [facility],
      )
    ).rows[0].id;
    encounter = (
      await db.query(
        "INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",
        [patient, facility],
      )
    ).rows[0].id;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).overrideProvider(PACS_GATEWAY).useValue({status:async()=>({provider:'Orthanc',configured:false,available:false,dicomWebAvailable:false,version:null,reason:'not-configured',checkedAt:new Date().toISOString()}),verifyStudy}).compile();
    app = configureApp(module.createNestApplication());
    await app.init();
    const auth = app.get(StaffAuthService);
    for (const [role, person] of Object.entries(people)) {
      const privileges = [
        'patient:read',
        'entry:read',
        'imaging:view',
        ...(role === 'reader'
          ? []
          : [
              'entry:write',
              'imaging:order',
              'imaging:cancel',
              'encounter:consult',
            ]),
      ];
      await db.query(
        'INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',
        [person, org, facility, [role], privileges],
      );
      const loginId = `problem-${randomUUID()}`,
        secret = randomUUID();
      await auth.register({ personId: person, loginId, secret });
      tokens[role] = (await auth.login({ loginId, secret })).token;
      await db.query(
        "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'synthetic-problem-test')",
        [person, patient, facility, encounter],
      );
    }
    await db.query(
      "INSERT INTO encounter.outpatient_visit(encounter_id,organization_id,facility_id,patient_id,stage,clinician_person_id,checked_in_by)VALUES($1,$2,$3,$4,'in-consultation',$5,$5)",
      [encounter, org, facility, patient, people.doctor],
    );
    async function test(name: string, active = true, mapped = facility) {
      const row = (
        await db.query(
          "INSERT INTO img.procedure(code,name,instructions,version,active,modality,body_region,laterality_policy)VALUES($1,$2,$3,1,$4,'XR','knee','required')RETURNING id",
          [
            code + '-' + procedureIds.length,
            name,
            'Synthetic radiology instructions',
            active,
          ],
        )
      ).rows[0].id;
      procedureIds.push(row);
      if (mapped)
        await db.query(
          'INSERT INTO img.facility_procedure(facility_id,procedure_id)VALUES($1,$2)',
          [mapped, row],
        );
      return row;
    }
    procedureId = await test('Synthetic available test');
    unmapped = await test('Synthetic unmapped test', true, '');
    inactive = await test('Synthetic retired test', false);
    await test('Synthetic foreign test', true, foreign);
  });
  afterAll(async () => {
    await app?.close();
    if (db && org) {
      await db.query(
        'DELETE FROM integration.staff_command WHERE organization_id=$1',
        [org],
      );
      await db.query(
        "DELETE FROM integration.outbox WHERE aggregate_type='imaging_order' AND aggregate_id IN (SELECT id FROM img.img_order WHERE patient_id=$1)",
        [patient],
      );
      await db.query('DELETE FROM img.critical_contact WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.critical_case WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.report_signoff WHERE report_id IN(SELECT rp.id FROM img.report rp JOIN img.img_order r ON r.id=rp.order_id WHERE r.patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.staff_report_detail WHERE report_id IN(SELECT rp.id FROM img.report rp JOIN img.img_order r ON r.id=rp.order_id WHERE r.patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.acquisition_completion WHERE case_id IN(SELECT c.id FROM img.acquisition_case c JOIN img.img_order r ON r.id=c.order_id WHERE r.patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.acquisition_case WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.facility_acquisition_template WHERE facility_id=$1',[facility]);
      await db.query('DELETE FROM img.acquisition_template WHERE procedure_id=ANY($1::uuid[])',[procedureIds]);
      await db.query('DELETE FROM patient.identifier WHERE patient_id=$1',[patient]);
      await db.query(
        'DELETE FROM img.study WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',
        [patient],
      );
      await db.query(
        'DELETE FROM img.report WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',
        [patient],
      );
      await db.query('DELETE FROM img.booking_arrival WHERE booking_id IN(SELECT b.id FROM img.schedule_booking b JOIN img.img_order o ON o.id=b.order_id WHERE o.patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.schedule_reservation WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.booking_release WHERE booking_id IN(SELECT b.id FROM img.schedule_booking b JOIN img.img_order o ON o.id=b.order_id WHERE o.patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.schedule_booking WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.schedule_slot WHERE resource_id=ANY($1::uuid[])',[resourceIds]);
      await db.query('DELETE FROM img.schedule_resource WHERE id=ANY($1::uuid[])',[resourceIds]);
      await db.query('DELETE FROM img.protocol_review WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',[patient]);
      await db.query('DELETE FROM img.facility_protocol WHERE template_id=ANY($1::uuid[])',[protocolIds]);
      await db.query('DELETE FROM img.protocol_template WHERE id=ANY($1::uuid[])',[protocolIds]);
      await db.query('DELETE FROM img.img_order WHERE patient_id=$1', [
        patient,
      ]);
      await db.query(
        'DELETE FROM img.facility_procedure WHERE procedure_id=ANY($1::uuid[])',
        [procedureIds],
      );
      await db.query('DELETE FROM img.procedure WHERE id=ANY($1::uuid[])', [
        procedureIds,
      ]);
      await db.query('DELETE FROM iam.care_assignment WHERE patient_id=$1', [
        patient,
      ]);
      await db.query(
        'DELETE FROM encounter.outpatient_visit WHERE encounter_id=$1',
        [encounter],
      );
      await db.query('DELETE FROM encounter.encounter WHERE id=$1', [
        encounter,
      ]);
      await db.query('DELETE FROM patient.patient WHERE id=$1', [patient]);
      await db.query(
        'DELETE FROM iam.session WHERE person_id=ANY($1::uuid[])',
        [Object.values(people)],
      );
      await db.query(
        'DELETE FROM iam.credential WHERE person_id=ANY($1::uuid[])',
        [Object.values(people)],
      );
      await db.query('DELETE FROM iam.membership WHERE organization_id=$1', [
        org,
      ]);
      await db.query('DELETE FROM org.facility WHERE organization_id=$1', [
        org,
      ]);
      await db.query('DELETE FROM org.organization WHERE id=$1', [org]);
    }
    await db?.end();
  });
  const body = () => ({
    encounterId: encounter,
    procedureId,
    procedureVersion: 1,
    laterality: 'left',
    safetyContext: 'Synthetic relevant safety context',
    urgency: 'urgent',
    indication: 'Synthetic clinical indication',
    attestation: true,
    commandKey: randomUUID(),
  });
  it('lists only active facility-approved tests and enforces ownership, patient care and privileges', async () => {
    const catalogue = (
      await call('doctor', `${base()}/catalogue?q=Synthetic`).expect(200)
    ).body;
    expect(catalogue.items.map((t: { id: string }) => t.id)).toEqual([
      procedureId,
    ]);
    await call('doctor', `${base()}/catalogue?q=x`).expect(400);
    expect(
      (await call('doctor', `${base()}/catalogue?q=%25%25`).expect(200)).body
        .items,
    ).toEqual([]);
    expect(
      (await call('doctor', `${base()}/contexts`).expect(200)).body[0]
        .encounterId,
    ).toBe(encounter);
    expect(
      (await call('other', `${base()}/contexts`).expect(200)).body,
    ).toEqual([]);
    await call('other', `${base()}/orders`, body()).expect(403);
    await call('reader', `${base()}/orders`, body()).expect(403);
    await call('doctor', `${base()}/catalogue`, undefined, foreign).expect(403);
    await call(
      'doctor',
      `staff/patients/${randomUUID()}/imaging/catalogue`,
    ).expect(404);
  });
  it('requires review, valid fields and an available pinned version and rejects actor spoofing', async () => {
    await call('doctor', `${base()}/orders`, {
      ...body(),
      attestation: false,
    }).expect(400);
    await call('doctor', `${base()}/orders`, {
      ...body(),
      orderedBy: people.other,
    }).expect(400);
    await call('doctor', `${base()}/orders`, {
      ...body(),
      indication: '   ',
    }).expect(400);
    await call('doctor', `${base()}/orders`, {
      ...body(),
      laterality: 'na',
    }).expect(400);
    await call('doctor', `${base()}/orders`, {
      ...body(),
      bodyRegion: 'chest',
    }).expect(400);
    for (const id of [unmapped, inactive])
      await call('doctor', `${base()}/orders`, {
        ...body(),
        procedureId: id,
      }).expect(409);
    await call('doctor', `${base()}/orders`, {
      ...body(),
      procedureVersion: 999,
    }).expect(409);
  });
  it('creates once under simultaneous retries, attributes the clinician and blocks duplicate pending requests', async () => {
    const input = body(),
      replies = await Promise.all([
        call('doctor', `${base()}/orders`, input),
        call('doctor', `${base()}/orders`, input),
      ]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    entryId = replies[0].body.id;
    expect(replies[1].body.id).toBe(entryId);
    expect(replies[0].body).toMatchObject({
      orderedBy: people.doctor,
      status: 'ordered',
      version: 1,
      procedure: { id: procedureId, version: 1 },
      indication: input.indication,
    });
    await call('doctor', `${base()}/orders`, body()).expect(409);
    await call('doctor', `${base()}/orders`, {
      ...input,
      urgency: 'routine',
    }).expect(409);
    const events = (
      await db.query(
        "SELECT producer,payload FROM integration.outbox WHERE aggregate_id=$1 AND type='imaging.ordered'",
        [entryId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].producer).toBe('imaging');
    expect(JSON.stringify(events)).not.toContain(input.indication);
  });
  it('keeps historical catalogue details pinned after a new approved version and rejects a stale selection', async () => {
    newTest = (
      await db.query(
        'INSERT INTO img.procedure(code,name,instructions,version,modality,body_region,laterality_policy)SELECT code,$2,$3,2,modality,body_region,laterality_policy FROM img.procedure WHERE id=$1 RETURNING id',
        [
          procedureId,
          'Synthetic available test v2',
          'Synthetic new requirement',
        ],
      )
    ).rows[0].id;
    procedureIds.push(newTest);
    await db.query(
      'INSERT INTO img.facility_procedure(facility_id,procedure_id)VALUES($1,$2)',
      [facility, newTest],
    );
    const catalogue = (
      await call('doctor', `${base()}/catalogue?q=Synthetic`).expect(200)
    ).body;
    expect(catalogue.items.map((t: { id: string }) => t.id)).toEqual([newTest]);
    await expect(
      db.query("UPDATE img.procedure SET body_region='changed' WHERE id=$1", [
        procedureId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const old = (
      await call('reader', `${base()}/orders/${entryId}`).expect(200)
    ).body;
    expect(old.procedure).toMatchObject({
      id: procedureId,
      version: 1,
      name: 'Synthetic available test',
    });
    await call('doctor', `${base()}/orders`, body()).expect(409);
    const duplicate = await call('doctor', `${base()}/orders`, {
      ...body(),
      procedureId: newTest,
      procedureVersion: 2,
    }).expect(409);
    expect(duplicate.body.code).toBe('IMAGING_ORDER_PENDING');
    await call(
      'doctor',
      `staff/patients/${randomUUID()}/imaging/orders/${entryId}`,
    ).expect(404);
  });
  it('cancels once with a reason and rejects stale or competing cancellations', async () => {
    const input = {
      expectedVersion: 1,
      reason: 'Synthetic cancellation reason',
      commandKey: randomUUID(),
    };
    await call('doctor', `${base()}/orders/${entryId}/cancel`, {
      ...input,
      expectedVersion: 7,
    }).expect(409);
    const replies = await Promise.all([
      call('doctor', `${base()}/orders/${entryId}/cancel`, input),
      call('doctor', `${base()}/orders/${entryId}/cancel`, {
        ...input,
        commandKey: randomUUID(),
      }),
    ]);
    expect(replies.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const order = (
      await call('reader', `${base()}/orders/${entryId}`).expect(200)
    ).body;
    expect(order).toMatchObject({
      status: 'cancelled',
      cancelReason: input.reason,
      cancelledBy: people.doctor,
      orderedBy: people.doctor,
      version: 2,
    });
    expect(order.cancelledAt).toBeTruthy();
    const history = (
      await call(
        'reader',
        `staff/charts/${patient}/history/investigations`,
      ).expect(200)
    ).body;
    expect(history.items[0].fields).toContainEqual({
      label: 'Cancellation reason',
      value: input.reason,
    });
    await expect(
      db.query(
        "INSERT INTO img.study(order_id,study_uid)VALUES($1,'Delayed')",
        [entryId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query("INSERT INTO img.report(order_id,text)VALUES($1,'Delayed')", [
        entryId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query("UPDATE img.img_order SET status='scheduled' WHERE id=$1", [
        entryId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('does not cancel after study/report data or radiology scheduling exists', async () => {
    const created = await call('doctor', `${base()}/orders`, {
      ...body(),
      procedureId: newTest,
      procedureVersion: 2,
    }).expect(201);
    entryId = created.body.id;
    const cancel = () =>
      call('doctor', `${base()}/orders/${entryId}/cancel`, {
        expectedVersion: 1,
        reason: 'Synthetic attempted late cancellation',
        commandKey: randomUUID(),
      });
    await db.query(
      "INSERT INTO img.study(order_id,study_uid)VALUES($1,'Synthetic')",
      [entryId],
    );
    await cancel().expect(409);
    await db.query('DELETE FROM img.study WHERE order_id=$1', [entryId]);
    await db.query(
      "INSERT INTO img.report(order_id,text)VALUES($1,'Synthetic')",
      [entryId],
    );
    await cancel().expect(409);
    await db.query('DELETE FROM img.report WHERE order_id=$1', [entryId]);
    await db.query("UPDATE img.img_order SET status='scheduled' WHERE id=$1", [
      entryId,
    ]);
    await cancel().expect(409);
    const evidence = (
      await db.query(
        'SELECT metadata FROM audit.audit_event WHERE tenant_id=$1',
        [org],
      )
    ).rows;
    expect(JSON.stringify(evidence)).not.toContain(body().indication);
    expect(JSON.stringify(evidence)).not.toContain(
      'Synthetic cancellation reason',
    );
    const receipts = (
      await db.query(
        'SELECT result FROM integration.staff_command WHERE organization_id=$1',
        [org],
      )
    ).rows;
    expect(JSON.stringify(receipts)).not.toContain(body().indication);
  });
  it('enforces non-applicable laterality and reads legacy requests without fabricating a catalogue link',async()=>{
    const chest=(await db.query("INSERT INTO img.procedure(code,name,modality,body_region,laterality_policy,version)VALUES($1,'Synthetic chest procedure','XR','chest','na',1)RETURNING id",[randomUUID()])).rows[0].id;
    procedureIds.push(chest);await db.query('INSERT INTO img.facility_procedure(facility_id,procedure_id)VALUES($1,$2)',[facility,chest]);
    await call('doctor',`${base()}/orders`,{...body(),procedureId:chest,laterality:'left'}).expect(400);
    const saved=(await call('doctor',`${base()}/orders`,{...body(),procedureId:chest,laterality:'na'}).expect(201)).body;
    expect(saved).toMatchObject({bodyRegion:'chest',laterality:'na',safetyContext:body().safetyContext,procedure:{modality:'XR',lateralityPolicy:'na'}});
    const legacy=(await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_code,body_region)VALUES($1,$2,'SYN-LEGACY','legacy-region')RETURNING id",[patient,encounter])).rows[0].id;
    const read=(await call('reader',`${base()}/orders/${legacy}`).expect(200)).body;expect(read.procedure).toBeNull();expect(read).toMatchObject({procedureCode:'SYN-LEGACY',bodyRegion:'legacy-region',orderedBy:null});
  });
  it('requires explicit radiology duty permission, including for chart readers and prescribers',async()=>{
    await call('reader','staff/radiology/queue').expect(403);
    await call('doctor','staff/radiology/queue').expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:worklist') WHERE person_id=$1",[people.reader]);
    await db.query('DELETE FROM iam.care_assignment WHERE person_id=$1',[people.reader]);
    const page=(await call('reader','staff/radiology/queue').expect(200)).body;
    expect(page.items.length).toBeGreaterThan(0);expect(page.items.every((r:{status:string})=>!['cancelled','final'].includes(r.status))).toBe(true);
    expect(page.items[0]).not.toHaveProperty('indication');expect(page.items[0]).not.toHaveProperty('safetyContext');
    await call('reader','staff/radiology/queue',undefined,foreign).expect(403);
  });
  it('validates filters and retains legacy requests and request-only details',async()=>{
    for(const query of ['status=cancelled','q=x','cursor=broken'])await call('reader','staff/radiology/queue?'+query).expect(400);
    const page=(await call('reader','staff/radiology/queue?q=SYN-LEGACY').expect(200)).body;
    expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({procedureName:'SYN-LEGACY',modality:null,catalogueVersion:null});
    const detail=(await call('reader','staff/radiology/orders/'+page.items[0].id).expect(200)).body;
    expect(detail).toHaveProperty('safetyContext');expect(detail).not.toHaveProperty('results');expect(detail).not.toHaveProperty('report');
    await call('reader','staff/radiology/orders/'+randomUUID()).expect(404);
  });
  it('paginates equal timestamps without omissions and prioritizes urgent requests',async()=>{
    const batch=[];for(let n=0;n<30;n++)batch.push((await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_code,body_region,urgency,created_at)VALUES($1,$2,$3,'chest',$4,'2026-01-01T12:00:00.123456Z')RETURNING id",[patient,encounter,'SYN-PAGING-'+n,n<2?'stat':'routine'])).rows[0].id);
    const first=(await call('reader','staff/radiology/queue?q=SYN-PAGING-').expect(200)).body;expect(first.items).toHaveLength(25);expect(first.counts.ordered).toBe(30);expect(first.items[0].urgency).toBe('stat');expect(first.nextCursor).toBeTruthy();
    const next=(await call('reader','staff/radiology/queue?q=SYN-PAGING-&cursor='+first.nextCursor).expect(200)).body;expect(next.items).toHaveLength(5);expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items,...next.items].map((r:{id:string})=>r.id)).size).toBe(30);
    await db.query('DELETE FROM img.img_order WHERE id=ANY($1::uuid[])',[batch]);
  });
  const protocolBody=(version=1)=>({expectedVersion:version,templateId:protocolId,templateVersion:1,decision:'hold',responses:{identity:{outcome:'unknown',note:'Synthetic identity clarification needed'}},reason:'Synthetic protocol planning rationale',attestation:true,commandKey:randomUUID()});
  it('requires explicit protocol privileges and facility-mapped procedure templates',async()=>{
    protocolOrder=(await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region)VALUES($1,$2,$3,1,'SYN-PROTOCOL','knee')RETURNING id",[patient,encounter,procedureId])).rows[0].id;
    protocolId=(await db.query("INSERT INTO img.protocol_template(code,name,procedure_id,version,instructions,policy_reference,checks)VALUES($1,'Synthetic protocol',$2,1,'Synthetic instructions','Synthetic policy v1',$3::jsonb)RETURNING id",[randomUUID(),procedureId,JSON.stringify([{key:'identity',label:'Synthetic identity confirmation',allowNotApplicable:false}])])).rows[0].id;protocolIds.push(protocolId);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocols').expect(403);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocol-reviews',protocolBody()).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:protocol') WHERE person_id=$1",[people.reader]);
    expect((await call('reader','staff/radiology/orders/'+protocolOrder+'/protocols').expect(200)).body).toEqual([]);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocol-reviews',protocolBody()).expect(409);
    await db.query('INSERT INTO img.facility_protocol(facility_id,template_id)VALUES($1,$2)',[facility,protocolId]);
    expect((await call('reader','staff/radiology/orders/'+protocolOrder+'/protocols').expect(200)).body[0].id).toBe(protocolId);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocols',undefined,foreign).expect(403);
  });
  it('rejects incomplete, spoofed or unresolved approval and records an idempotent attributed hold',async()=>{
    const path='staff/radiology/orders/'+protocolOrder+'/protocol-reviews';
    await call('reader',path,{...protocolBody(),attestation:false}).expect(400);
    await call('reader',path,{...protocolBody(),responses:{}}).expect(400);
    await call('reader',path,{...protocolBody(),responses:{identity:{outcome:'not-applicable',note:'Synthetic exception'}}}).expect(400);
    await call('reader',path,{...protocolBody(),responses:{identity:{outcome:'clear',note:'',actor:'spoof'}}}).expect(400);
    await call('reader',path,{...protocolBody(),decision:'approved'}).expect(409);
    const input=protocolBody();const replies=await Promise.all([call('reader',path,input),call('reader',path,input)]);expect(replies.every(r=>r.status===201)).toBe(true);
    expect(replies[0].body).toMatchObject({version:2,status:'ordered'});expect(replies[0].body.protocolReviews).toHaveLength(1);expect(replies[0].body.protocolReviews[0]).toMatchObject({decision:'hold',orderVersion:1,template:{id:protocolId,version:1}});
    expect((await db.query('SELECT reviewed_by FROM img.protocol_review WHERE order_id=$1',[protocolOrder])).rows[0].reviewed_by).toBe(people.reader);
    await call('reader',path,{...input,reason:'Changed payload same key'}).expect(409);
  });
  it('requires current order/template versions and appends approval without scheduling or acquisition',async()=>{
    const path='staff/radiology/orders/'+protocolOrder+'/protocol-reviews';
    await call('reader',path,protocolBody()).expect(409);
    await db.query('UPDATE img.facility_protocol SET active=false WHERE template_id=$1',[protocolId]);await call('reader',path,protocolBody(2)).expect(409);await db.query('UPDATE img.facility_protocol SET active=true WHERE template_id=$1',[protocolId]);
    const input={...protocolBody(2),decision:'approved',responses:{identity:{outcome:'clear',note:'Synthetic identity verified under policy'}}};
    const result=(await call('reader',path,input).expect(201)).body;expect(result).toMatchObject({version:3,status:'ordered'});expect(result.protocolReviews.map((r:{decision:string})=>r.decision)).toEqual(['approved','hold']);
    await call('doctor',base()+'/orders/'+protocolOrder+'/cancel',{expectedVersion:3,reason:'Synthetic cancellation after review',commandKey:randomUUID()}).expect(409);
    await expect(db.query("UPDATE img.protocol_template SET instructions='changed' WHERE id=$1",[protocolId])).rejects.toMatchObject({code:'23514'});
    await expect(db.query("UPDATE img.protocol_review SET reason='changed' WHERE order_id=$1",[protocolOrder])).rejects.toMatchObject({code:'23514'});
  });
  const window=()=>({from:new Date(Date.now()+23*3600000).toISOString(),to:new Date(Date.now()+27*3600000).toISOString()});
  const scheduleBody=(slotId=scheduleSlot)=>({expectedVersion:3,slotId,reason:'Synthetic scheduling handover',attestation:true,commandKey:randomUUID()});
  it('requires explicit scheduling capability and only lists matching available capacity',async()=>{
    const r=(await db.query("INSERT INTO img.schedule_resource(facility_id,code,name,modality,location)VALUES($1,$2,'Synthetic XR room','XR','Synthetic imaging department')RETURNING id",[facility,randomUUID()])).rows[0].id;resourceIds.push(r);
    const start=new Date(Date.now()+24*3600000),end=new Date(start.getTime()+30*60000);
    scheduleSlot=(await db.query('INSERT INTO img.schedule_slot(resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4)RETURNING id',[r,procedureId,start,end])).rows[0].id;
    secondSlot=(await db.query('INSERT INTO img.schedule_slot(resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4)RETURNING id',[r,procedureId,end,new Date(end.getTime()+30*60000)])).rows[0].id;
    await expect(db.query('UPDATE img.schedule_resource SET blocked=true,block_reason=NULL WHERE id=$1',[r])).rejects.toMatchObject({code:'23514'});
    await expect(db.query("UPDATE img.schedule_resource SET modality='CT' WHERE id=$1",[r])).rejects.toMatchObject({code:'23514'});
    const params=new URLSearchParams(window());
    await call('reader','staff/radiology/orders/'+protocolOrder+'/slots?'+params).expect(403);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/schedule',scheduleBody()).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:schedule') WHERE person_id=$1",[people.reader]);
    const page=(await call('reader','staff/radiology/orders/'+protocolOrder+'/slots?'+params).expect(200)).body;expect(page.items.map((item:{id:string})=>item.id)).toEqual([scheduleSlot,secondSlot]);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/slots?from=invalid&to=invalid').expect(400);
    await db.query("UPDATE img.schedule_resource SET blocked=true,block_reason='Synthetic downtime' WHERE id=$1",[r]);
    expect((await call('reader','staff/radiology/orders/'+protocolOrder+'/slots?'+params).expect(200)).body.items).toEqual([]);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/schedule',scheduleBody()).expect(409);
    await db.query('UPDATE img.schedule_resource SET blocked=false WHERE id=$1',[r]);
    await expect(db.query('INSERT INTO img.schedule_slot(resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4)',[r,procedureId,new Date(start.getTime()+60000),end])).rejects.toMatchObject({code:'23514'});
  });
  it('rechecks planning approval, stale versions, slot state and review attestation',async()=>{
    const path='staff/radiology/orders/'+protocolOrder+'/schedule';
    await call('reader',path,{...scheduleBody(),attestation:false}).expect(400);
    await call('reader',path,{...scheduleBody(),expectedVersion:2}).expect(409);
    await call('reader',path,scheduleBody(randomUUID())).expect(409);
    await db.query('UPDATE img.schedule_slot SET active=false WHERE id=$1',[scheduleSlot]);await call('reader',path,scheduleBody()).expect(409);await db.query('UPDATE img.schedule_slot SET active=true WHERE id=$1',[scheduleSlot]);
    await db.query('UPDATE img.facility_protocol SET active=false WHERE template_id=$1',[protocolId]);await call('reader',path,scheduleBody()).expect(409);await db.query('UPDATE img.facility_protocol SET active=true WHERE template_id=$1',[protocolId]);
    const unapproved=(await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region)VALUES($1,$2,$3,1,'SYN-UNAPPROVED','knee')RETURNING id",[patient,encounter,procedureId])).rows[0].id;
    await call('reader','staff/radiology/orders/'+unapproved+'/schedule',{...scheduleBody(),expectedVersion:1}).expect(409);
  });
  it('serializes competing bookings and makes retries idempotent without overwriting capacity',async()=>{
    const competitor=(await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region)VALUES($1,$2,$3,1,'SYN-COMPETING','knee')RETURNING id",[patient,encounter,procedureId])).rows[0].id;
    await call('reader','staff/radiology/orders/'+competitor+'/protocol-reviews',{...protocolBody(1),decision:'approved',responses:{identity:{outcome:'clear',note:''}}}).expect(201);
    const input=scheduleBody(),competitorInput={...scheduleBody(),expectedVersion:2};const responses=await Promise.all([call('reader','staff/radiology/orders/'+protocolOrder+'/schedule',input),call('reader','staff/radiology/orders/'+competitor+'/schedule',competitorInput)]);expect(responses.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
    const winner=responses[0].status===201?protocolOrder:competitor;bookedOrder=winner;const winnerInput=responses[0].status===201?input:competitorInput;
    const record=(await call('reader','staff/radiology/orders/'+winner).expect(200)).body;expect(record.status).toBe('scheduled');expect(record.booking).toMatchObject({id:scheduleSlot,resourceName:'Synthetic XR room',reason:input.reason});
    if(winnerInput){const retry=(await call('reader','staff/radiology/orders/'+winner+'/schedule',winnerInput).expect(201)).body;expect(retry.booking.bookingId).toBe(record.booking.bookingId);}
    expect((await db.query('SELECT count(*)::int AS count FROM img.schedule_booking WHERE slot_id=$1',[scheduleSlot])).rows[0].count).toBe(1);
    await expect(db.query("UPDATE img.schedule_resource SET name='Changed room' WHERE id=$1",[resourceIds[0]])).rejects.toMatchObject({code:'23514'});
    const bookingAudit=(await db.query("SELECT metadata FROM audit.audit_event WHERE tenant_id=$1 AND action='imaging.scheduled'",[org])).rows;expect(bookingAudit).toHaveLength(1);expect(JSON.stringify(bookingAudit)).not.toContain(input.reason);
    await expect(db.query("UPDATE img.schedule_booking SET reason='changed' WHERE slot_id=$1",[scheduleSlot])).rejects.toMatchObject({code:'23514'});
    await expect(db.query("UPDATE img.schedule_slot SET ends_at=ends_at+interval '1 minute' WHERE id=$1",[scheduleSlot])).rejects.toMatchObject({code:'23514'});
  });
  const currentBooking=async()=> (await call('reader','staff/radiology/orders/'+bookedOrder).expect(200)).body;
  it('separates appointment change permissions and retains the current reservation on invalid replacements',async()=>{
    const order=await currentBooking(),input={expectedVersion:order.version,bookingId:order.booking.bookingId,slotId:randomUUID(),reason:'Synthetic appointment change reason',attestation:true,commandKey:randomUUID()};
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',input).expect(403);
    const {slotId,...cancel}=input;void slotId;await call('reader','staff/radiology/orders/'+bookedOrder+'/appointment-cancel',cancel).expect(403);
    await db.query("UPDATE iam.membership SET privileges=privileges||ARRAY['imaging:reschedule','imaging:appointment:cancel'] WHERE person_id=$1",[people.reader]);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,attestation:false}).expect(400);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,expectedVersion:1}).expect(409);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,bookingId:randomUUID()}).expect(409);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',input).expect(409);
    const retained=await currentBooking();expect(retained.booking.bookingId).toBe(order.booking.bookingId);expect(retained.bookingHistory).toHaveLength(1);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',input,foreign).expect(403);
  });
  it('atomically replaces the appointment, releases old capacity and deduplicates concurrent retries',async()=>{
    const old=await currentBooking(),input={expectedVersion:old.version,bookingId:old.booking.bookingId,slotId:secondSlot,reason:'Synthetic replacement handover',attestation:true,commandKey:randomUUID()};
    const replies=await Promise.all([call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',input),call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);
    const result=replies[0].body;expect(result).toMatchObject({status:'scheduled',version:old.version+1});expect(result.booking.id).toBe(secondSlot);expect(result.bookingHistory).toHaveLength(2);expect(result.bookingHistory[1]).toMatchObject({bookingId:old.booking.bookingId,release:{kind:'rescheduled',reason:input.reason}});
    const rows=(await db.query('SELECT * FROM img.schedule_reservation WHERE order_id=$1',[bookedOrder])).rows;expect(rows).toHaveLength(1);expect(rows[0].slot_id).toBe(secondSlot);
    const available=(await call('reader','staff/radiology/orders/'+bookedOrder+'/slots?'+new URLSearchParams(window())).expect(200)).body;expect(available.items.map((r:{id:string})=>r.id)).toContain(scheduleSlot);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,commandKey:randomUUID()}).expect(409);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,reason:'Changed reason same command'}).expect(409);
  });
  it('honours a later protocol hold while allowing appointment cancellation and retains history',async()=>{
    let order=await currentBooking();await call('reader','staff/radiology/orders/'+bookedOrder+'/protocol-reviews',{...protocolBody(order.version),decision:'hold'}).expect(201);order=await currentBooking();
    const common={expectedVersion:order.version,bookingId:order.booking.bookingId,reason:'Synthetic capacity release under hold',attestation:true,commandKey:randomUUID()};
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...common,slotId:scheduleSlot}).expect(409);
    expect((await currentBooking()).booking.bookingId).toBe(order.booking.bookingId);
    const replies=await Promise.all([call('reader','staff/radiology/orders/'+bookedOrder+'/appointment-cancel',common),call('reader','staff/radiology/orders/'+bookedOrder+'/appointment-cancel',common)]);expect(replies.map(r=>r.status)).toEqual([201,201]);
    const result=replies[0].body;expect(result).toMatchObject({status:'ordered',booking:null,scheduledAt:null});expect(result.bookingHistory).toHaveLength(2);expect(result.bookingHistory[0].release.kind).toBe('cancelled');
    expect((await db.query('SELECT count(*)::int AS count FROM img.schedule_reservation WHERE order_id=$1',[bookedOrder])).rows[0].count).toBe(0);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/schedule',{...scheduleBody(),expectedVersion:result.version}).expect(409);
  });
  it('rebooks released capacity only with approval, guards processed appointments and keeps change narratives private',async()=>{
    let order=await currentBooking();await call('reader','staff/radiology/orders/'+bookedOrder+'/protocol-reviews',{...protocolBody(order.version),decision:'approved',responses:{identity:{outcome:'clear',note:''}}}).expect(201);order=await currentBooking();
    const result=(await call('reader','staff/radiology/orders/'+bookedOrder+'/schedule',{...scheduleBody(),expectedVersion:order.version}).expect(201)).body;expect(result.booking.id).toBe(scheduleSlot);expect(result.bookingHistory).toHaveLength(3);
    await expect(db.query("UPDATE img.booking_release SET reason='overwrite' WHERE booking_id=$1",[result.bookingHistory[1].bookingId])).rejects.toMatchObject({code:'23514'});
    await db.query('INSERT INTO img.study(order_id,study_uid)VALUES($1,$2)',[bookedOrder,randomUUID()]);
    const input={expectedVersion:result.version,bookingId:result.booking.bookingId,reason:'Synthetic change after acquisition',attestation:true,commandKey:randomUUID()};
    await call('reader','staff/radiology/orders/'+bookedOrder+'/reschedule',{...input,slotId:secondSlot}).expect(409);
    await call('reader','staff/radiology/orders/'+bookedOrder+'/appointment-cancel',input).expect(409);
    const changes=(await db.query("SELECT metadata FROM audit.audit_event WHERE tenant_id=$1 AND action IN('imaging.appointment_rescheduled','imaging.appointment_cancelled')",[org])).rows;expect(changes).toHaveLength(2);expect(JSON.stringify(changes)).not.toContain('Synthetic');
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:appointment:cancel') WHERE person_id=$1",[people.reader]);await call('reader','staff/radiology/orders/'+bookedOrder+'/appointment-cancel',input).expect(403);
  });
  let attendanceFuture:{order:string;booking:string},attendancePast:{order:string;booking:string};
  async function attendanceFixture(past=false){
    const order=(await db.query("INSERT INTO img.img_order(patient_id,encounter_id,procedure_id,procedure_version,procedure_code,body_region)VALUES($1,$2,$3,1,'SYN-ATTENDANCE','knee')RETURNING id",[patient,encounter,procedureId])).rows[0].id;
    await call('reader','staff/radiology/orders/'+order+'/protocol-reviews',{...protocolBody(1),decision:'approved',responses:{identity:{outcome:'clear',note:''}}}).expect(201);
    const resource=(await db.query("INSERT INTO img.schedule_resource(facility_id,code,name,modality,location)VALUES($1,$2,'Synthetic attendance room','XR','Synthetic imaging')RETURNING id",[facility,randomUUID()])).rows[0].id;resourceIds.push(resource);
    const start=new Date(Date.now()+(past?-48:48)*3600000),end=new Date(start.getTime()+30*60000),slot=(await db.query('INSERT INTO img.schedule_slot(resource_id,procedure_id,starts_at,ends_at)VALUES($1,$2,$3,$4)RETURNING id',[resource,procedureId,start,end])).rows[0].id;
    if(!past){const saved=(await call('reader','staff/radiology/orders/'+order+'/schedule',{...scheduleBody(slot),expectedVersion:2}).expect(201)).body;return {order,booking:saved.booking.bookingId};}
    // Historical appointment fixture only: bypass time-of-booking triggers on this transaction/connection.
    const client=await db.connect();try{await client.query('BEGIN');await client.query("SET LOCAL session_replication_role='replica'");const review=(await client.query('SELECT id FROM img.protocol_review WHERE order_id=$1',[order])).rows[0].id;
    const booking=(await client.query("INSERT INTO img.schedule_booking(order_id,slot_id,protocol_review_id,order_version,reason,booked_by)VALUES($1,$2,$3,2,'Synthetic historical appointment',$4)RETURNING id",[order,slot,review,people.reader])).rows[0].id;await client.query('INSERT INTO img.schedule_reservation(order_id,slot_id,booking_id)VALUES($1,$2,$3)',[order,slot,booking]);await client.query("UPDATE img.img_order SET status='scheduled',version=3 WHERE id=$1",[order]);await client.query('COMMIT');return {order,booking};}catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
  }
  const arrivalBody=(booking:string,version=3)=>({expectedVersion:version,bookingId:booking,identifierMethods:['full-name','date-of-birth'],note:'Synthetic arrival handover',attestation:true,commandKey:randomUUID()});
  const noShowBody=(booking:string,version=3)=>({expectedVersion:version,bookingId:booking,reason:'Synthetic attendance checked after appointment end',attestation:true,commandKey:randomUUID()});
  it('requires separate attendance permissions and actual two-identifier verification',async()=>{
    attendanceFuture=await attendanceFixture();const path='staff/radiology/orders/'+attendanceFuture.order;
    await call('reader',path+'/arrive',arrivalBody(attendanceFuture.booking)).expect(403);await call('reader',path+'/no-show',noShowBody(attendanceFuture.booking)).expect(403);
    await db.query("UPDATE iam.membership SET privileges=privileges||ARRAY['imaging:arrival','imaging:no-show'] WHERE person_id=$1",[people.reader]);
    await call('reader',path+'/arrive',{...arrivalBody(attendanceFuture.booking),attestation:false}).expect(400);
    await call('reader',path+'/arrive',{...arrivalBody(attendanceFuture.booking),identifierMethods:['full-name','full-name']}).expect(400);
    await call('reader',path+'/arrive',{...arrivalBody(attendanceFuture.booking),identifierMethods:['full-name','mrn']}).expect(400);
    await call('reader',path+'/arrive',arrivalBody(attendanceFuture.booking,1)).expect(409);
    await call('reader',path+'/no-show',noShowBody(attendanceFuture.booking)).expect(409);
    await call('reader',path+'/arrive',arrivalBody(attendanceFuture.booking),foreign).expect(403);
  });
  it('records arrival once without clearing a protocol hold or advancing acquisition',async()=>{
    await call('reader','staff/radiology/orders/'+attendanceFuture.order+'/protocol-reviews',protocolBody(3)).expect(201);
    const input=arrivalBody(attendanceFuture.booking,4),path='staff/radiology/orders/'+attendanceFuture.order+'/arrive';const replies=await Promise.all([call('reader',path,input),call('reader',path,input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);
    expect(replies[0].body).toMatchObject({version:5,status:'scheduled',protocolDecision:'hold',booking:{arrival:{identifierMethods:['full-name','date-of-birth'],note:input.note}}});expect(replies[0].body.arrivedAt).toBeTruthy();
    expect((await db.query('SELECT arrived_by FROM img.booking_arrival WHERE booking_id=$1',[attendanceFuture.booking])).rows[0].arrived_by).toBe(people.reader);
    await call('reader',path,{...input,commandKey:randomUUID()}).expect(409);await expect(db.query("UPDATE img.booking_arrival SET note='overwrite' WHERE booking_id=$1",[attendanceFuture.booking])).rejects.toMatchObject({code:'23514'});
  });
  it('marks no-show only after an ended appointment and retains the clinical request and attributed history',async()=>{
    attendancePast=await attendanceFixture(true);const path='staff/radiology/orders/'+attendancePast.order+'/no-show',input=noShowBody(attendancePast.booking);
    const replies=await Promise.all([call('reader',path,input),call('reader',path,input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body).toMatchObject({version:4,status:'ordered',booking:null,arrivedAt:null,bookingHistory:[{release:{kind:'no-show',reason:input.reason}}]});
    expect((await db.query('SELECT released_by FROM img.booking_release WHERE booking_id=$1',[attendancePast.booking])).rows[0].released_by).toBe(people.reader);
    await call('reader','staff/radiology/orders/'+attendancePast.order+'/arrive',arrivalBody(attendancePast.booking,4)).expect(409);
  });
  it('serializes conflicting attendance decisions and prevents no-show after arrival',async()=>{
    const arrived=await attendanceFixture(true);await call('reader','staff/radiology/orders/'+arrived.order+'/arrive',arrivalBody(arrived.booking)).expect(201);await call('reader','staff/radiology/orders/'+arrived.order+'/no-show',noShowBody(arrived.booking,4)).expect(409);
    const race=await attendanceFixture(true),replies=await Promise.all([call('reader','staff/radiology/orders/'+race.order+'/arrive',arrivalBody(race.booking)),call('reader','staff/radiology/orders/'+race.order+'/no-show',noShowBody(race.booking))]);expect(replies.map(r=>r.status).sort((a,b)=>a-b)).toEqual([201,409]);
    const facts=(await db.query('SELECT (SELECT count(*) FROM img.booking_arrival WHERE booking_id=$1)::int AS arrivals,(SELECT count(*) FROM img.booking_release WHERE booking_id=$1)::int AS releases',[race.booking])).rows[0];expect(facts.arrivals+facts.releases).toBe(1);
  });
  it('blocks processed arrival, rechecks withdrawn permission and keeps attendance notes out of audit evidence',async()=>{
    const processed=await attendanceFixture();await db.query('INSERT INTO img.study(order_id,study_uid)VALUES($1,$2)',[processed.order,randomUUID()]);await call('reader','staff/radiology/orders/'+processed.order+'/arrive',arrivalBody(processed.booking)).expect(409);
    const audit=(await db.query("SELECT metadata FROM audit.audit_event WHERE tenant_id=$1 AND action IN('imaging.arrived','imaging.appointment_no_show')",[org])).rows;expect(audit.length).toBeGreaterThanOrEqual(3);expect(JSON.stringify(audit)).not.toContain('Synthetic');
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:arrival') WHERE person_id=$1",[people.reader]);await call('reader','staff/radiology/orders/'+processed.order+'/arrive',arrivalBody(processed.booking)).expect(403);
  });
  it('computes acquisition prerequisites from current facts without granting clinical clearance',async()=>{
    const ready=await attendanceFixture();await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:arrival') WHERE person_id=$1",[people.reader]);
    const before=(await call('reader','staff/radiology/orders/'+ready.order+'/readiness').expect(200)).body;expect(before.prerequisitesSatisfied).toBe(false);expect(before.checks.find((c:{id:string})=>c.id==='arrival').met).toBe(false);
    await call('reader','staff/radiology/orders/'+ready.order+'/arrive',arrivalBody(ready.booking)).expect(201);
    const after=(await call('reader','staff/radiology/orders/'+ready.order+'/readiness').expect(200)).body;expect(after.prerequisitesSatisfied).toBe(true);expect(after.checks).toHaveLength(5);expect(after).not.toHaveProperty('canAcquire');
    const resource=(await db.query('SELECT s.resource_id FROM img.schedule_booking b JOIN img.schedule_slot s ON s.id=b.slot_id WHERE b.id=$1',[ready.booking])).rows[0].resource_id;
    await db.query("UPDATE img.schedule_resource SET blocked=true,block_reason='Synthetic downtime' WHERE id=$1",[resource]);expect((await call('reader','staff/radiology/orders/'+ready.order+'/readiness').expect(200)).body.checks.find((c:{id:string})=>c.id==='resource').met).toBe(false);
    await db.query('UPDATE img.schedule_resource SET blocked=false WHERE id=$1',[resource]);await db.query('UPDATE img.facility_protocol SET active=false WHERE template_id=$1',[protocolId]);expect((await call('reader','staff/radiology/orders/'+ready.order+'/readiness').expect(200)).body.checks.find((c:{id:string})=>c.id==='protocol').met).toBe(false);await db.query('UPDATE img.facility_protocol SET active=true WHERE template_id=$1',[protocolId]);
    await call('doctor','staff/radiology/orders/'+ready.order+'/readiness').expect(403);await call('reader','staff/radiology/orders/'+ready.order+'/readiness',undefined,foreign).expect(403);
  });
  it('restricts PACS diagnostics to current radiology duty users and never returns server credentials',async()=>{
    await call('doctor','staff/radiology/pacs/status').expect(403);const status=(await call('reader','staff/radiology/pacs/status').expect(200)).body;expect(status.provider).toBe('Orthanc');expect(status).not.toHaveProperty('baseUrl');expect(status).not.toHaveProperty('password');expect(status).not.toHaveProperty('username');
  });
  let acquisitionOrder:string,acquisitionTemplate:string;
  const prepareBody=()=>({expectedVersion:4,templateId:acquisitionTemplate,templateVersion:1,responses:{day:{outcome:'clear',note:'Synthetic procedure-day evidence'}},reason:'Synthetic preparation handover',attestation:true,commandKey:randomUUID()});
  const confirmBody=()=>({expectedVersion:5,reason:'Synthetic completed acquisition',attestation:true,commandKey:randomUUID()});
  it('requires acquisition permission and an arrived appointment',async()=>{
    const fixture=await attendanceFixture();acquisitionOrder=fixture.order;
    acquisitionTemplate=(await db.query("INSERT INTO img.acquisition_template(code,name,procedure_id,version,dicom_modality,instructions,policy_reference,checks)VALUES($1,'Synthetic day checklist',$2,1,'DX','Synthetic only','TEST ONLY',$3::jsonb)RETURNING id",[randomUUID(),procedureId,JSON.stringify([{key:'day',label:'Synthetic day verification',allowNotApplicable:false}])])).rows[0].id;
    await db.query('INSERT INTO img.facility_acquisition_template(facility_id,template_id)VALUES($1,$2)',[facility,acquisitionTemplate]);
    const path='staff/radiology/orders/'+acquisitionOrder;
    await call('doctor',path+'/acquisition').expect(403);await call('reader',path+'/acquisition',undefined,foreign).expect(403);
    await call('reader',path+'/acquisition-prepare',prepareBody()).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:acquire') WHERE person_id=$1",[people.reader]);
    await call('reader',path+'/acquisition-prepare',{...prepareBody(),expectedVersion:3}).expect(409);
    await call('reader',path+'/arrive',arrivalBody(fixture.booking)).expect(201);
    await call('reader',path+'/acquisition-prepare',prepareBody()).expect(409); // No facility MRN yet.
    await db.query("INSERT INTO patient.identifier(patient_id,facility_id,system,value)VALUES($1,$2::uuid,'urn:pulse:mrn:'||$2::text,$3)",[patient,facility,'SYN-ACQ-'+randomUUID()]);
  });
  it('rejects stale, unresolved, unknown, unexpected and unapproved day checklists',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder+'/acquisition-prepare';
    await call('reader',path,{...prepareBody(),attestation:false}).expect(400);
    await call('reader',path,{...prepareBody(),expectedVersion:3}).expect(409);
    for(const responses of [{},{day:{outcome:'concern',note:'Stop'}},{day:{outcome:'unknown',note:'Unknown'}},{day:{outcome:'not-applicable',note:'Not allowed'}},{day:{outcome:'clear',note:''},extra:{outcome:'clear',note:''}}])await call('reader',path,{...prepareBody(),responses}).expect(400);
    await db.query('UPDATE img.facility_acquisition_template SET active=false WHERE template_id=$1',[acquisitionTemplate]);await call('reader',path,prepareBody()).expect(409);await db.query('UPDATE img.facility_acquisition_template SET active=true WHERE template_id=$1',[acquisitionTemplate]);
    await call('reader',path,{...prepareBody(),studyUid:'browser-overwrite'}).expect(400);
  });
  it('creates one immutable work item under concurrent retry without claiming acquisition',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder,input=prepareBody();
    const replies=await Promise.all([call('reader',path+'/acquisition-prepare',input),call('reader',path+'/acquisition-prepare',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body.workItem.id).toBe(replies[1].body.workItem.id);
    expect(replies[0].body.workItem).toMatchObject({issuer:'PULSE:'+facility,dicomModality:'DX',completion:null});expect(replies[0].body.workItem.accession).toHaveLength(16);expect(replies[0].body.workItem.studyUid).toMatch(/^2\.25\.\d+$/);
    expect((await call('reader',path).expect(200)).body).toMatchObject({status:'protocolled',version:5});expect((await db.query('SELECT id FROM img.study WHERE order_id=$1',[acquisitionOrder])).rows).toHaveLength(0);
    await expect(db.query("UPDATE img.acquisition_case SET reason='changed' WHERE order_id=$1",[acquisitionOrder])).rejects.toMatchObject({code:'23514'});
    await expect(db.query("UPDATE img.acquisition_template SET dicom_modality='CT' WHERE id=$1",[acquisitionTemplate])).rejects.toMatchObject({code:'23514'});
    await call('reader',path+'/acquisition-prepare',{...input,reason:'Reused key'}).expect(409);
  });
  it('keeps prepared requests unchanged on missing, mismatched and unavailable PACS studies',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder;
    for(const reason of ['not-found','identity-mismatch','unavailable']){verifyStudy.mockResolvedValueOnce({verified:false,reason,checkedAt:new Date().toISOString()} as never);await call('reader',path+'/acquisition-confirm',confirmBody()).expect(409);}
    expect((await call('reader',path).expect(200)).body).toMatchObject({status:'protocolled',version:5});expect((await db.query('SELECT id FROM img.study WHERE order_id=$1',[acquisitionOrder])).rows).toHaveLength(0);
    await db.query('UPDATE img.facility_acquisition_template SET active=false WHERE template_id=$1',[acquisitionTemplate]);const count=verifyStudy.mock.calls.length;await call('reader',path+'/acquisition-confirm',confirmBody()).expect(409);expect(verifyStudy.mock.calls.length).toBe(count);await db.query('UPDATE img.facility_acquisition_template SET active=true WHERE template_id=$1',[acquisitionTemplate]);
    const resource=(await db.query('SELECT s.resource_id FROM img.schedule_reservation res JOIN img.schedule_slot s ON s.id=res.slot_id WHERE res.order_id=$1',[acquisitionOrder])).rows[0].resource_id;
    await db.query("UPDATE img.schedule_resource SET blocked=true,block_reason='Synthetic downtime' WHERE id=$1",[resource]);await call('reader',path+'/acquisition-confirm',confirmBody()).expect(409);await db.query('UPDATE img.schedule_resource SET blocked=false WHERE id=$1',[resource]);
    const mrn=(await db.query('SELECT value FROM patient.identifier WHERE patient_id=$1',[patient])).rows[0].value;await db.query("UPDATE patient.identifier SET value='SYN-CHANGED' WHERE patient_id=$1",[patient]);await call('reader',path+'/acquisition-confirm',confirmBody()).expect(409);await db.query('UPDATE patient.identifier SET value=$2 WHERE patient_id=$1',[patient,mrn]);expect(verifyStudy.mock.calls.length).toBe(count);
  });
  it('links only the generated work item once, retains attribution and excludes narratives from evidence',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder,input=confirmBody(),count=verifyStudy.mock.calls.length;
    const replies=await Promise.all([call('reader',path+'/acquisition-confirm',input),call('reader',path+'/acquisition-confirm',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(verifyStudy.mock.calls.length).toBe(count+1);
    expect(replies[0].body.workItem.completion).toMatchObject({seriesCount:1,instanceCount:3,reason:input.reason});expect((await call('reader',path).expect(200)).body).toMatchObject({status:'acquired',version:6});expect((await db.query('SELECT id FROM img.study WHERE order_id=$1',[acquisitionOrder])).rows).toHaveLength(1);
    await call('reader',path+'/acquisition-confirm',confirmBody()).expect(409);
    const evidence=JSON.stringify((await db.query("SELECT metadata FROM audit.audit_event WHERE resource_id=$1 AND action IN('imaging.acquisition_prepared','imaging.acquired')",[acquisitionOrder])).rows);expect(evidence).not.toContain(input.reason);expect(evidence).not.toContain('Synthetic procedure-day evidence');
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:acquire') WHERE person_id=$1",[people.reader]);await call('reader',path+'/acquisition-confirm',input).expect(403);
  });
  let reportStudy:string,reportId:string,handoffOrder:string,handoffReportId:string;
  const reportContent=()=>({technique:'Synthetic technique',comparison:'Synthetic priors reviewed',findings:'Synthetic report findings',impression:'Synthetic impression',recommendations:'Synthetic recommendation, not an actual appointment'});
  const reportInput=(version=6,previous:string|null=null)=>({expectedVersion:version,expectedReportId:previous,studyId:reportStudy,content:reportContent(),priority:'routine',reason:'Synthetic draft revision',commandKey:randomUUID()});
  const reportSign=(version=8)=>({expectedVersion:version,reportId,reviewReference:'Synthetic approved workstation study review',reason:'Synthetic final sign-off',attestation:true,commandKey:randomUUID()});
  const chartImaging=async()=>{const page=(await call('doctor','staff/charts/'+patient+'/history/investigations').expect(200)).body;return page.items.find((r:{id:string})=>r.id===acquisitionOrder);};
  it('separates report writing and sign-off permission from acquisition and duty reads',async()=>{
    reportStudy=(await db.query('SELECT id FROM img.study WHERE order_id=$1',[acquisitionOrder])).rows[0].id;const path='staff/radiology/orders/'+acquisitionOrder;
    await call('reader',path+'/report-drafts',reportInput()).expect(403);await call('reader',path+'/report-signoff',{...reportSign(),reportId:randomUUID()}).expect(403);
    await call('doctor',path+'/reports').expect(403);await call('reader',path+'/reports',undefined,foreign).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:report') WHERE person_id=$1",[people.reader]);
    await call('reader',path+'/report-drafts',{...reportInput(),authorId:people.other}).expect(400);
    await call('reader',path+'/report-drafts',{...reportInput(),content:{...reportContent(),html:'bad'}}).expect(400);
    await call('reader',path+'/report-drafts',{...reportInput(),studyId:randomUUID()}).expect(409);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/report-drafts',reportInput()).expect(409);
  });
  it('saves one attributed immutable report revision under concurrent retry and withholds the draft',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder,input=reportInput(),replies=await Promise.all([call('reader',path+'/report-drafts',input),call('reader',path+'/report-drafts',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);reportId=replies[0].body.reports[0].id;expect(replies[1].body.reports[0].id).toBe(reportId);
    expect(replies[0].body.reports[0]).toMatchObject({version:1,status:'draft',authorId:people.reader,content:reportContent(),supersedesId:null,signoff:null});expect((await call('reader',path).expect(200)).body).toMatchObject({status:'reported',version:7});expect((await chartImaging()).diagnostic.report).toBeNull();
    await expect(db.query("UPDATE img.report SET text='changed' WHERE id=$1",[reportId])).rejects.toMatchObject({code:'23514'});await expect(db.query("UPDATE img.report SET status='final' WHERE id=$1",[reportId])).rejects.toMatchObject({code:'23514'});
    await call('reader',path+'/report-drafts',{...input,reason:'Same key different report'}).expect(409);
  });
  it('appends revisions, rejects stale report identities and holds urgent/critical publication',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder;await call('reader',path+'/report-drafts',reportInput()).expect(409);
    await call('reader',path+'/report-drafts',reportInput(7,randomUUID())).expect(409);
    const revised=(await call('reader',path+'/report-drafts',reportInput(7,reportId)).expect(201)).body;expect(revised.reports).toHaveLength(2);expect(revised.reports[0].supersedesId).toBe(reportId);reportId=revised.reports[0].id;
    await db.query("UPDATE iam.membership SET privileges=ARRAY(SELECT DISTINCT x FROM unnest(privileges||ARRAY['imaging:worklist','imaging:finalize'])x) WHERE person_id=$1",[people.other]);
    await call('other',path+'/report-signoff',{...reportSign(),attestation:false}).expect(400);
    await call('other',path+'/report-signoff',{...reportSign(),reportId:randomUUID()}).expect(409);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:acquire') WHERE person_id=$1",[people.reader]);
    const criticalFixture=await attendanceFixture(),criticalPath='staff/radiology/orders/'+criticalFixture.order;
    await call('reader',criticalPath+'/arrive',arrivalBody(criticalFixture.booking)).expect(201);await call('reader',criticalPath+'/acquisition-prepare',prepareBody()).expect(201);await call('reader',criticalPath+'/acquisition-confirm',confirmBody()).expect(201);
    const criticalStudy=(await db.query('SELECT id FROM img.study WHERE order_id=$1',[criticalFixture.order])).rows[0].id;
    const critical=(await call('reader',criticalPath+'/report-drafts',{...reportInput(),studyId:criticalStudy,priority:'critical'}).expect(201)).body.reports[0];
    handoffOrder=criticalFixture.order;handoffReportId=critical.id;
    await call('other',criticalPath+'/report-signoff',{...reportSign(7),reportId:critical.id}).expect(409);
    await call('reader',criticalPath+'/report-drafts',{...reportInput(7,critical.id),studyId:criticalStudy,priority:'routine'}).expect(409);
    expect((await chartImaging()).diagnostic.report).toBeNull();expect((await db.query('SELECT report_id FROM img.report_signoff WHERE report_id=$1',[critical.id])).rows).toHaveLength(0);
    const routine=(await call('reader',path+'/report-drafts',reportInput(8,reportId)).expect(201)).body;reportId=routine.reports[0].id;expect(routine.reports.map((r:{version:number})=>r.version)).toEqual([3,2,1]);
  });
  it('pins the exact current report for final sign-off and publishes only the final text to the chart',async()=>{
    const path='staff/radiology/orders/'+acquisitionOrder,input=reportSign(9);
    await call('reader',path+'/report-signoff',input).expect(403);await call('other',path+'/report-signoff',{...input,reportId:randomUUID()}).expect(409);
    await db.query("UPDATE encounter.encounter SET status='discharged' WHERE id=$1",[encounter]);
    const replies=await Promise.all([call('other',path+'/report-signoff',input),call('other',path+'/report-signoff',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body.reports[0]).toMatchObject({id:reportId,status:'final',version:3,signoff:{reviewReference:input.reviewReference,reason:input.reason}});
    expect((await db.query('SELECT verified_by FROM img.report_signoff WHERE report_id=$1',[reportId])).rows[0].verified_by).toBe(people.other);expect((await call('reader',path).expect(200)).body).toMatchObject({status:'final',version:10});
    await db.query("UPDATE encounter.encounter SET status='open' WHERE id=$1",[encounter]);
    const published=await chartImaging();expect(published.diagnostic.report).toMatchObject({version:3,text:expect.stringContaining(reportContent().findings)});expect(published.diagnostic.verifiedAt).toBeTruthy();
    await expect(db.query("UPDATE img.report SET text='overwrite final' WHERE id=$1",[reportId])).rejects.toMatchObject({code:'23514'});await expect(db.query("UPDATE img.report_signoff SET reason='overwrite' WHERE report_id=$1",[reportId])).rejects.toMatchObject({code:'23514'});
    await call('reader',path+'/report-drafts',reportInput(10,reportId)).expect(409);
    const metadata=JSON.stringify((await db.query("SELECT metadata FROM audit.audit_event WHERE resource_id=$1 AND action IN('imaging.report_drafted','imaging.finalized')",[acquisitionOrder])).rows);expect(metadata).not.toContain(reportContent().findings);expect(metadata).not.toContain(input.reviewReference);expect(metadata).not.toContain(input.reason);
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:finalize') WHERE person_id=$1",[people.other]);await call('other',path+'/report-signoff',input).expect(403);
  });
  const handoffInput=()=>({expectedVersion:7,reportId:handoffReportId,recipientId:people.doctor,dueAt:new Date(Date.now()+15*60000).toISOString(),policyReference:'Synthetic facility handoff policy',attestation:true,commandKey:randomUUID()});
  const handoffBase=()=>`staff/imaging-handoffs/orders/${handoffOrder}`;
  const contactInput=(version=1)=>({expectedCaseVersion:version,channel:'phone',outcome:'unreachable',readBack:false,occurredAt:new Date().toISOString(),note:'Synthetic actual contact evidence',attestation:true,commandKey:randomUUID()});
  const ackInput=(version=3)=>({expectedCaseVersion:version,note:'Synthetic clinical receipt acknowledged; treatment is separate',attestation:true,commandKey:randomUUID()});
  it('separates imaging communication from duty reads and validates named clinical responsibility',async()=>{
    await call('reader',handoffBase()+'/start',handoffInput()).expect(403);await call('doctor','staff/imaging-handoffs/count').expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:communicate') WHERE person_id=$1",[people.reader]);
    expect((await call('reader',handoffBase()+'/recipients').expect(200)).body).toEqual([]);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:acknowledge') WHERE person_id=$1",[people.doctor]);
    expect((await call('reader',handoffBase()+'/recipients').expect(200)).body.map((p:{personId:string})=>p.personId)).toContain(people.doctor);
    await call('reader',handoffBase()+'/start',{...handoffInput(),recipientId:people.reader}).expect(400);
    await call('reader',handoffBase()+'/start',{...handoffInput(),recipientId:randomUUID()}).expect(400);
    await call('reader',handoffBase()+'/start',{...handoffInput(),dueAt:new Date(Date.now()-60000).toISOString()}).expect(400);
    await call('reader',handoffBase()+'/start',{...handoffInput(),reportId:randomUUID()}).expect(409);
    await call('reader',handoffBase()+'/start',handoffInput(),foreign).expect(403);
  });
  it('pins the exact report once and exposes it only to scoped radiology or the named assigned clinician',async()=>{
    const input={...handoffInput(),dueAt:new Date(Date.now()+3000).toISOString()},replies=await Promise.all([call('reader',handoffBase()+'/start',input),call('reader',handoffBase()+'/start',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body.case).toMatchObject({reportId:handoffReportId,version:1,orderVersion:8,recipientId:people.doctor,acknowledgedAt:null});
    expect((await call('doctor','staff/imaging-handoffs/count').expect(200)).body).toMatchObject({pending:1,overdue:0});expect((await call('doctor',handoffBase()).expect(200)).body.content).toMatchObject(reportContent());
    await new Promise(resolve=>setTimeout(resolve,3100));expect((await call('doctor','staff/imaging-handoffs/count').expect(200)).body).toMatchObject({pending:1,overdue:1});
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:acknowledge') WHERE person_id=$1",[people.other]);await call('other',handoffBase()).expect(404);
    const study=(await db.query('SELECT id FROM img.study WHERE order_id=$1',[handoffOrder])).rows[0].id;await call('reader','staff/radiology/orders/'+handoffOrder+'/report-drafts',{...reportInput(8,handoffReportId),studyId:study,priority:'critical'}).expect(409);
    await expect(db.query("INSERT INTO img.report(order_id,text,author_id,version)VALUES($1,'changed',$2,2)",[handoffOrder,people.reader])).rejects.toMatchObject({code:'23514'});
    await expect(db.query('UPDATE img.critical_case SET recipient_id=$2,version=version+1 WHERE order_id=$1',[handoffOrder,people.other])).rejects.toMatchObject({code:'23514'});
    await call('doctor',handoffBase()+'/acknowledge',ackInput(1)).expect(409);
  });
  it('requires actual communication/read-back and preserves unreachable attempts before acknowledgement',async()=>{
    await call('reader',handoffBase()+'/contact',{...contactInput(),outcome:'reached'}).expect(400);
    await call('reader',handoffBase()+'/contact',{...contactInput(),occurredAt:new Date(Date.now()+3600000).toISOString()}).expect(400);
    const missed=contactInput(),replies=await Promise.all([call('reader',handoffBase()+'/contact',missed),call('reader',handoffBase()+'/contact',missed)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body.contacts).toHaveLength(1);
    await call('doctor',handoffBase()+'/acknowledge',ackInput(2)).expect(409);
    const reached={...contactInput(2),outcome:'reached',readBack:true};await call('reader',handoffBase()+'/contact',reached).expect(201);
    await call('other',handoffBase()+'/acknowledge',ackInput()).expect(403);await call('doctor',handoffBase()+'/acknowledge',ackInput(1)).expect(409);
    await db.query('UPDATE iam.care_assignment SET effective_to=now() WHERE person_id=$1 AND patient_id=$2',[people.doctor,patient]);await call('doctor',handoffBase()).expect(404);await call('doctor',handoffBase()+'/acknowledge',ackInput()).expect(403);await db.query('UPDATE iam.care_assignment SET effective_to=NULL WHERE person_id=$1 AND patient_id=$2',[people.doctor,patient]);
  });
  it('allows only the named clinician to acknowledge and unlocks the pinned urgent/critical report for final sign-off',async()=>{
    const input=ackInput(),replies=await Promise.all([call('doctor',handoffBase()+'/acknowledge',input),call('doctor',handoffBase()+'/acknowledge',input)]);expect(replies.map(r=>r.status)).toEqual([201,201]);expect(replies[0].body.case.acknowledgedAt).toBeTruthy();expect(replies[0].body.case.acknowledgementNote).toBe(input.note);
    expect((await call('doctor','staff/imaging-handoffs/count').expect(200)).body.pending).toBe(0);
    await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:finalize') WHERE person_id=$1",[people.other]);
    await call('other','staff/radiology/orders/'+handoffOrder+'/report-signoff',{...reportSign(8),reportId:handoffReportId}).expect(201);
    expect((await db.query('SELECT status FROM img.img_order WHERE id=$1',[handoffOrder])).rows[0].status).toBe('final');
    const clinical=(await call('doctor','staff/charts/'+patient+'/history/investigations').expect(200)).body.items.find((item:{id:string})=>item.id===handoffOrder);expect(clinical.fields.find((field:{label:string})=>field.label==='Clinical acknowledgement').value).toContain('Acknowledged');
    await expect(db.query("UPDATE img.critical_contact SET note='overwrite' WHERE order_id=$1",[handoffOrder])).rejects.toMatchObject({code:'23514'});
    const audit=JSON.stringify((await db.query("SELECT metadata FROM audit.audit_event WHERE resource_id=$1 AND action LIKE 'imaging.handoff_%'",[handoffOrder])).rows);expect(audit).not.toContain(input.note);expect(audit).not.toContain(contactInput().note);expect(audit).not.toContain(handoffInput().policyReference);
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:communicate') WHERE person_id=$1",[people.reader]);await call('reader',handoffBase()+'/contact',contactInput(4)).expect(403);
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:acknowledge') WHERE person_id=$1",[people.doctor]);await call('doctor',handoffBase()+'/acknowledge',input).expect(403);
  });
  it('blocks processed requests, keeps narratives out of evidence and rechecks protocol revocation',async()=>{
    await db.query("INSERT INTO img.study(order_id,study_uid)VALUES($1,$2)",[protocolOrder,randomUUID()]);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocol-reviews',protocolBody(3)).expect(409);
    const evidence=(await db.query("SELECT metadata FROM audit.audit_event WHERE tenant_id=$1 AND resource_id=$2 AND action='imaging.protocol_reviewed'",[org,protocolOrder])).rows;expect(evidence.length).toBeGreaterThanOrEqual(2);expect(JSON.stringify(evidence)).not.toContain(protocolBody().reason);expect(JSON.stringify(evidence)).not.toContain('clarification');
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:protocol') WHERE person_id=$1",[people.reader]);
    await call('reader','staff/radiology/orders/'+protocolOrder+'/protocol-reviews',protocolBody(3)).expect(403);
  });
  it('records metadata-only radiology read audits and rechecks revoked duty access',async()=>{
    const events=(await db.query("SELECT action,resource_type FROM audit.audit_event WHERE tenant_id=$1 AND action LIKE 'imaging.%read'",[org])).rows;
    expect(events.some(r=>r.action==='imaging.queue_read')).toBe(true);expect(events.some(r=>r.action==='imaging.duty_order_read')).toBe(true);
    await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:worklist') WHERE person_id=$1",[people.reader]);
    await call('reader','staff/radiology/queue').expect(403);
  });
  it('blocks legacy staff bypass, closed encounters and revoked care or membership', async () => {
    await call('doctor', 'imaging/orders', {
      patientId: patient,
      encounterId: encounter,
      procedureCode: 'Synthetic',
    }).expect(409);
    await call('doctor', `imaging/orders/${entryId}/cancel`, {
      reason: 'Synthetic bypass',
    }).expect(409);
    await call('doctor', `imaging/orders/${entryId}/viewer`).expect(409);
    await db.query(
      "UPDATE encounter.encounter SET status='discharged',ended_at=now()WHERE id=$1",
      [encounter],
    );
    await call('doctor', `${base()}/orders`, {
      ...body(),
      procedureId: newTest,
      procedureVersion: 2,
    }).expect(403);
    await db.query(
      'UPDATE iam.care_assignment SET effective_to=now() WHERE person_id=$1',
      [people.doctor],
    );
    await call('doctor', `${base()}/orders/${entryId}`).expect(404);
    await db.query(
      'UPDATE iam.membership SET effective_to=now() WHERE person_id=$1',
      [people.reader],
    );
    await call('reader', `${base()}/orders/${entryId}`).expect(403);
  });
});
