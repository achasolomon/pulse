import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
describe.skipIf(!process.env.DATABASE_URL)('staff imaging requests', () => {
  const procedureIds: string[] = [];
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
    }).compile();
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
      await db.query(
        'DELETE FROM img.study WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',
        [patient],
      );
      await db.query(
        'DELETE FROM img.report WHERE order_id IN(SELECT id FROM img.img_order WHERE patient_id=$1)',
        [patient],
      );
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
