import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
describe.skipIf(!process.env.DATABASE_URL)('longitudinal chart history', () => {
  let app: INestApplication,
    db: Pool,
    org: string,
    fac: string,
    foreign: string,
    patient: string,
    other: string,
    encounter: string,
    foreignEncounter: string,
    token: string,
    limited: string;
  const person = randomUUID(),
    limitedPerson = randomUUID(),
    otherAuthor = randomUUID();
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).port !== '5437')
      throw new Error('Use disposable PostgreSQL on 5437');
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    org = (
      await db.query(
        'INSERT INTO org.organization(name,code)VALUES($1,$2)RETURNING id',
        ['History synthetic group', randomUUID()],
      )
    ).rows[0].id;
    async function facility(code: string) {
      return (
        await db.query(
          'INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',
          [org, 'History synthetic hospital', code],
        )
      ).rows[0].id;
    }
    fac = await facility('HISTORY');
    foreign = await facility('FOREIGN');
    async function createPatient(facilityId: string) {
      return (
        await db.query(
          "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id,contact_phone,contact_address)VALUES('Synthetic','History','1990-01-15','F',$1,'000-000','Synthetic address')RETURNING id",
          [facilityId],
        )
      ).rows[0].id;
    }
    patient = await createPatient(fac);
    other = await createPatient(fac);
    const foreignPatient = await createPatient(foreign);
    encounter = (
      await db.query(
        "INSERT INTO encounter.encounter(patient_id,facility_id,type,status,started_at,ended_at)VALUES($1,$2,'outpatient','discharged','2026-01-01T10:00:00.123456Z','2026-01-01T11:00:00Z')RETURNING id",
        [patient, fac],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO encounter.encounter(patient_id,facility_id,type,status,started_at)SELECT $1,$2,'outpatient','open','2026-01-01T10:00:00.123456Z'::timestamptz FROM generate_series(1,27)",
      [patient, fac],
    );
    foreignEncounter = (
      await db.query(
        "INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",
        [foreignPatient, foreign],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO clin.observation(patient_id,encounter_id,code,value_num,unit,recorded_by)VALUES($1,$2,'heart-rate',72,'bpm',$3),($1,$4,'foreign-observation',999,'bpm',$3)",
      [patient, encounter, person, foreignEncounter],
    );
    const signed = (
      await db.query(
        "INSERT INTO clin.note(patient_id,encounter_id,author_id,chief_complaint,history,assessment,plan,status,signed_at)VALUES($1,$2,$3,'Synthetic signed note','Prior treatment history','Synthetic assessment','Follow-up plan','signed',now())RETURNING id",
        [patient, encounter, otherAuthor],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO clin.note_addendum(note_id,text)VALUES($1,'Synthetic correction retained')",
      [signed],
    );
    await db.query(
      "INSERT INTO clin.note(patient_id,encounter_id,author_id,chief_complaint)VALUES($1,$2,$3,'Own draft'),($1,$2,$4,'Other private draft')",
      [patient, encounter, person, otherAuthor],
    );
    await db.query(
      "INSERT INTO clin.entry(patient_id,encounter_id,kind,display,status)VALUES($1,$2,'problem','Synthetic historical diagnosis','resolved')",
      [patient, encounter],
    );
    const medication = (
      await db.query(
        'INSERT INTO med.medication(code,name)VALUES($1,$2)RETURNING id',
        [randomUUID(), 'Synthetic medication'],
      )
    ).rows[0].id;
    const prescription = (
      await db.query(
        "INSERT INTO med.request(patient_id,encounter_id,medication_id,dose,dose_unit,route,frequency,status)VALUES($1,$2,$3,'1','tablet','oral','once daily','completed')RETURNING id",
        [patient, encounter, medication],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO med.administration(request_id,dose_given,outcome)VALUES($1,'1 tablet','given')",
      [prescription],
    );
    const lab = (
      await db.query(
        'INSERT INTO lab.test(code,name)VALUES($1,$2)RETURNING id',
        [randomUUID(), 'Synthetic blood test'],
      )
    ).rows[0].id;
    await db.query(
      'INSERT INTO lab.lab_order(patient_id,encounter_id,test_id,test_version)VALUES($1,$2,$3,1)',
      [patient, encounter, lab],
    );
    await db.query(
      "INSERT INTO img.img_order(patient_id,encounter_id,procedure_code,body_region)VALUES($1,$2,'Synthetic X-ray','chest')",
      [patient, encounter],
    );
    await db.query(
      "INSERT INTO docs.document(patient_id,encounter_id,name,mime,storage_key)VALUES($1,$2,'Synthetic referral','application/pdf','PRIVATE-STORAGE-KEY')",
      [patient, encounter],
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(module.createNestApplication());
    await app.init();
    const auth = app.get(StaffAuthService);
    for (const [actor, privileges] of [
      [
        person,
        [
          'patient:read',
          'encounter:read',
          'observation:read',
          'entry:read',
          'note:read',
          'medication:read',
          'lab:read',
          'document:read',
        ],
      ],
      [limitedPerson, ['patient:read']],
    ] as [string, string[]][]) {
      await db.query(
        "INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,ARRAY['staff'],$4)",
        [actor, org, fac, privileges],
      );
      await db.query(
        "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,kind)VALUES($1,$2,$3,'history-test')",
        [actor, patient, fac],
      );
      const loginId = randomUUID(),
        secret = randomUUID();
      await auth.register({ personId: actor, loginId, secret });
      const session = await auth.login({ loginId, secret });
      if (actor === person) token = session.token;
      else limited = session.token;
    }
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });
  function get(section: string, query = '', actor = token, id = patient) {
    return request(app.getHttpServer())
      .get(`/api/v1/staff/charts/${id}/history/${section}${query}`)
      .set('Authorization', `Bearer ${actor}`)
      .set('x-tenant-id', org)
      .set('x-facility-id', fac);
  }
  it('paginates all visits without skipping records sharing microsecond timestamps', async () => {
    const first = await get('visits').expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.items).toHaveLength(25);
    const second = await get(
      'visits',
      '?cursor=' + first.body.nextCursor,
    ).expect(200);
    expect(second.body.items).toHaveLength(3);
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (i: { id: string }) => i.id,
        ),
      ).size,
    ).toBe(28);
    expect(
      [...first.body.items, ...second.body.items].find(
        (i: { id: string }) => i.id === encounter,
      ).status,
    ).toBe('discharged');
    await get('visits', '?cursor=invalid').expect(400);
  });
  it('returns historical vitals with attribution and excludes inconsistent encounters', async () => {
    const data = await get('vitals').expect(200);
    expect(data.body.items).toHaveLength(1);
    expect(
      data.body.items[0].fields.find(
        (f: { label: string }) => f.label === 'Value',
      ).value,
    ).toBe('72 bpm');
    expect(
      (await get('vitals', '?encounterId=' + foreignEncounter).expect(200)).body
        .items,
    ).toHaveLength(0);
    expect(
      (await get('vitals', '?encounterId=' + encounter).expect(200)).body.items,
    ).toHaveLength(1);
    await get('vitals', '?encounterId=invalid').expect(400);
  });
  it('includes signed notes, addenda and own drafts while hiding other drafts', async () => {
    const data = await get('notes').expect(200);
    expect(
      data.body.items.map((i: { title: string }) => i.title).sort(),
    ).toEqual(['Own draft', 'Synthetic signed note']);
    expect(JSON.stringify(data.body)).toContain(
      'Synthetic correction retained',
    );
    expect(JSON.stringify(data.body)).toContain('Follow-up plan');
  });
  it('includes resolved entries, prescriptions, actual administrations and safe document metadata', async () => {
    expect((await get('entries').expect(200)).body.items[0].status).toBe(
      'resolved',
    );
    const medications = await get('medications').expect(200);
    expect(medications.body.items[0].status).toBe('completed');
    expect(JSON.stringify(medications.body)).toContain('given');
    const docs = await get('documents').expect(200);
    expect(docs.body.items[0].title).toBe('Synthetic referral');
    expect(JSON.stringify(docs.body)).not.toContain('PRIVATE-STORAGE-KEY');
    expect(JSON.stringify((await get('profile').expect(200)).body)).toContain(
      '000-000',
    );
  });
  it('exposes only verified lab versions and the latest final imaging report', async () => {
    const labOrder=(await db.query('SELECT id FROM lab.lab_order WHERE patient_id=$1',[patient])).rows[0].id;
    const imagingOrder=(await db.query('SELECT id FROM img.img_order WHERE patient_id=$1',[patient])).rows[0].id;
    const verifiedAt=new Date('2026-10-15T10:00:00Z');
    try {
      await db.query("INSERT INTO lab.result(order_id,component,value_text,unit,flag,version,created_at)VALUES($1,'Synthetic component','old','unit','low',1,'2026-10-15T08:00:00Z'),($1,'Synthetic component','verified-value','unit','critical',2,'2026-10-15T09:00:00Z'),($1,'Synthetic component','unverified-new-value','unit','high',3,'2026-10-15T11:00:00Z')",[labOrder]);
      await db.query("UPDATE lab.lab_order SET status='resulted' WHERE id=$1",[labOrder]);
      expect((await get('investigations').expect(200)).body.items[0].diagnostic.results).toEqual([]);
      await db.query("UPDATE lab.lab_order SET status='verified',verified_at=$2 WHERE id=$1",[labOrder,verifiedAt]);
      const verified=(await get('investigations').expect(200)).body.items[0];
      expect(verified.diagnostic.results).toMatchObject([{component:'Synthetic component',value:'verified-value',flag:'critical',version:2}]);
      expect(JSON.stringify(verified)).not.toContain('unverified-new-value');
      await db.query("UPDATE iam.membership SET privileges=array_append(privileges,'imaging:view')WHERE person_id=$1",[person]);
      await db.query("UPDATE img.img_order SET status='final' WHERE id=$1",[imagingOrder]);
      await db.query("INSERT INTO img.report(order_id,text,status,version)VALUES($1,'withheld-draft','draft',1),($1,'published-final','final',2)",[imagingOrder]);
      const reports=(await get('investigations').expect(200)).body.items;
      expect(reports.find((item:{id:string})=>item.id===imagingOrder).diagnostic.report).toMatchObject({text:'published-final',version:2});
      expect(JSON.stringify(reports)).not.toContain('withheld-draft');
      await db.query("INSERT INTO img.report(order_id,text,status,version)VALUES($1,'new-withheld-draft','draft',3)",[imagingOrder]);
      const newer=(await get('investigations').expect(200)).body.items;
      expect(newer.find((item:{id:string})=>item.id===imagingOrder).diagnostic.report).toBeNull();
      expect(JSON.stringify(newer)).not.toContain('new-withheld-draft');
    } finally {
      await db.query('DELETE FROM lab.result WHERE order_id=$1',[labOrder]);
      await db.query('DELETE FROM img.report WHERE order_id=$1',[imagingOrder]);
      await db.query("UPDATE lab.lab_order SET status='ordered',verified_at=NULL WHERE id=$1",[labOrder]);
      await db.query("UPDATE img.img_order SET status='ordered' WHERE id=$1",[imagingOrder]);
      await db.query("UPDATE iam.membership SET privileges=array_remove(privileges,'imaging:view')WHERE person_id=$1",[person]);
    }
  });
  it('filters laboratory and imaging data by each domain privilege', async () => {
    const labs = await get('investigations').expect(200);
    expect(labs.body.items.map((i: { title: string }) => i.title)).toEqual([
      'Synthetic blood test',
    ]);
    await db.query(
      "UPDATE iam.membership SET privileges=array_append(privileges,'imaging:view')WHERE person_id=$1",
      [person],
    );
    expect((await get('investigations').expect(200)).body.items).toHaveLength(
      2,
    );
  });
  it('rejects missing section privileges, missing care and revoked care, and records metadata-only audit', async () => {
    await get('notes', '', limited).expect(403);
    await get('visits', '', limited).expect(403);
    await get('profile', '', limited).expect(200);
    await get('visits', '', token, other).expect(403);
    await get('unknown').expect(400);
    const audits = (
      await db.query(
        "SELECT metadata FROM audit.audit_event WHERE actor_id=$1 AND action='patient.chart_history_read'",
        [person],
      )
    ).rows;
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain('Follow-up plan');
    await db.query(
      'UPDATE iam.care_assignment SET effective_to=now() WHERE person_id=$1',
      [person],
    );
    await get('vitals').expect(403);
  });
});
