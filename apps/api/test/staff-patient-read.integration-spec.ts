import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
import type { PulseDatabase } from '../src/platform/database/db.types.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'staff patient directory and chart scope',
  () => {
    let app: INestApplication, db: Kysely<PulseDatabase>;
    let org: string,
      facility: string,
      foreign: string,
      patient: string,
      otherPatient: string,
      foreignPatient: string;
    let token: string, blockedToken: string;
    const person = randomUUID(),
      blockedPerson = randomUUID();
    beforeAll(async () => {
      db = new Kysely({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: process.env.DATABASE_URL }),
        }),
      });
      org = (
        await db
          .insertInto('org.organization')
          .values({ name: 'Patient read synthetic group', code: randomUUID() })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      facility = (
        await db
          .insertInto('org.facility')
          .values({
            organization_id: org,
            name: 'Patient scope hospital',
            code: 'READ',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      foreign = (
        await db
          .insertInto('org.facility')
          .values({
            organization_id: org,
            name: 'Foreign patient hospital',
            code: 'FOREIGN',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('iam.membership')
        .values([
          {
            organization_id: org,
            facility_id: facility,
            person_id: person,
            roles: ['doctor'],
            privileges: [
              'patient:read',
              'patient:write',
              'observation:read',
              'entry:read',
            ],
          },
          {
            organization_id: org,
            facility_id: facility,
            person_id: blockedPerson,
            roles: ['staff'],
            privileges: [],
          },
        ])
        .execute();
      async function create(name: string, fac = facility) {
        return (
          await db
            .insertInto('patient.patient')
            .values({
              given_name: 'Synthetic',
              family_name: name,
              date_of_birth: '1990-01-15',
              sex: 'F',
              facility_id: fac,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      }
      patient = await create('Adeyemi');
      otherPatient = await create('Bello');
      foreignPatient = await create('Adeyemi', foreign);
      for (let i = 0; i < 25; i++) await create(`Worklist-${i}`);
      const merged = await create('Retired');
      await db
        .updateTable('patient.patient')
        .set({ status: 'retired-duplicate' })
        .where('id', '=', merged)
        .execute();
      await db
        .insertInto('patient.identifier')
        .values({
          patient_id: patient,
          system: `urn:pulse:mrn:${facility}`,
          value: 'READ-0001',
          facility_id: facility,
        })
        .execute();
      await db
        .insertInto('iam.care_assignment')
        .values([
          {
            patient_id: patient,
            person_id: person,
            facility_id: facility,
            kind: 'attending',
            effective_from: new Date(0),
            effective_to: null,
          },
          {
            patient_id: otherPatient,
            person_id: person,
            facility_id: facility,
            kind: 'attending',
            effective_from: new Date(0),
            effective_to: null,
          },
        ])
        .execute();
      await db
        .insertInto('clin.observation')
        .values([
          {
            patient_id: patient,
            encounter_id: null,
            code: 'heart-rate',
            value_num: 72,
            value_text: null,
            unit: 'bpm',
            taken_at: new Date('2026-10-14T09:00:00Z'),
          },
          {
            patient_id: patient,
            encounter_id: null,
            code: 'heart-rate',
            value_num: 80,
            value_text: null,
            unit: 'bpm',
            taken_at: new Date('2026-10-14T08:00:00Z'),
          },
        ])
        .execute();
      await db
        .insertInto('clin.entry')
        .values({
          patient_id: patient,
          encounter_id: null,
          kind: 'allergy',
          code: null,
          display: 'Penicillin',
          status: 'active',
        })
        .execute();
      const invalidEncounter = (
        await db
          .insertInto('encounter.encounter')
          .values({
            patient_id: foreignPatient,
            facility_id: foreign,
            type: 'outpatient',
            status: 'open',
            started_at: new Date(),
            ended_at: null,
            department_id: null,
            bed: null,
            disposition: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('clin.observation')
        .values({
          patient_id: patient,
          encounter_id: invalidEncounter,
          code: 'foreign-encounter-value',
          value_num: 999,
          value_text: null,
          unit: null,
        })
        .execute();
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = configureApp(module.createNestApplication());
      await app.init();
      const auth = app.get(StaffAuthService);
      async function session(personId: string) {
        const loginId = `patient-read-${randomUUID()}`,
          secret = randomUUID();
        await auth.register({ personId, loginId, secret });
        return (await auth.login({ loginId, secret })).token;
      }
      token = await session(person);
      blockedToken = await session(blockedPerson);
    });
    afterAll(async () => {
      await app?.close();
      await db?.destroy();
    });
    function get(path: string, actor = token, fac = facility, tenant = org) {
      return request(app.getHttpServer())
        .get(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${actor}`)
        .set('x-tenant-id', tenant)
        .set('x-facility-id', fac);
    }
    it('requires real identity, current membership and patient privilege', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/staff/patients')
        .expect(401);
      await get('staff/patients', blockedToken).expect(403);
      await get('staff/patients', token, foreign).expect(403);
      await get('staff/patients', token, facility, randomUUID()).expect(403);
    });
    it('lists only selected-facility patients with MRNs and stable pages', async () => {
      const first = await get('staff/patients').expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body.items).toHaveLength(25);
      const next = await get(
        `staff/patients?cursor=${first.body.nextCursor}`,
      ).expect(200);
      expect(next.body.items).toHaveLength(2);
      expect(
        new Set([...first.body.items, ...next.body.items].map((p) => p.id))
          .size,
      ).toBe(27);
      expect(
        [...first.body.items, ...next.body.items].every(
          (p) => p.facilityId === facility,
        ),
      ).toBe(true);
      const identifier = await get('staff/patients?q=READ-0001').expect(200);
      expect(identifier.body.items).toMatchObject([
        { id: patient, mrn: 'READ-0001', dateOfBirth: '1990-01-15' },
      ]);
      expect(
        (await get('staff/patients?status=retired-duplicate').expect(200)).body
          .items,
      ).toHaveLength(1);
      expect(
        (await get('staff/patients?q=%25%25').expect(200)).body.items,
      ).toHaveLength(0);
      await get('staff/patients?q=a').expect(400);
      await get('staff/patients?cursor=invalid').expect(400);
    });
    it('requires patient care access and rejects caller-supplied patient-header tricks', async () => {
      const unassigned = (
        await db
          .selectFrom('patient.patient')
          .select('id')
          .where('family_name', '=', 'Worklist-1')
          .where('facility_id', '=', facility)
          .executeTakeFirstOrThrow()
      ).id;
      await get(`staff/charts/${unassigned}`)
        .set('x-patient-id', patient)
        .expect(403);
      await get(`staff/charts/${foreignPatient}`).expect(403);
      const chart = await get(`staff/charts/${patient}`).expect(200);
      expect(chart.body.patient).toMatchObject({
        id: patient,
        mrn: 'READ-0001',
        dateOfBirth: '1990-01-15',
      });
      expect(chart.body.observations.items).toHaveLength(1);
      expect(chart.body.observations.items[0]).toMatchObject({
        code: 'heart-rate',
        value: '72',
        unit: 'bpm',
        takenAt: '2026-10-14T09:00:00.000Z',
      });
      expect(chart.body.entries.items[0].display).toBe('Penicillin');
      const audit = await db
        .selectFrom('audit.audit_event')
        .select(['actor_id', 'facility_id'])
        .where('resource_id', '=', patient)
        .where('action', '=', 'patient.chart_overview_read')
        .executeTakeFirstOrThrow();
      expect(audit).toMatchObject({ actor_id: person, facility_id: facility });
    });
    it('returns server-derived adult BP and temperature signals through the scoped chart', async () => {
      const ids = Array.from({length: 7}, () => randomUUID());
      const encounterId = randomUUID();
      try {
        await db.insertInto('encounter.encounter').values({id: encounterId, patient_id: patient, facility_id: facility, type: 'outpatient', status: 'open'}).execute();
        await db.insertInto('clin.observation').values([
          { id: ids[0], patient_id: patient, encounter_id: encounterId, code: 'bp-systolic', value_num: '190', unit: 'mmHg', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[1], patient_id: patient, encounter_id: encounterId, code: 'bp-diastolic', value_num: '70', unit: 'mmHg', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[2], patient_id: patient, code: 'temperature', value_num: '38', unit: '°C', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[3], patient_id: patient, encounter_id: encounterId, code: 'weight', value_num: '120', unit: 'kg', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[4], patient_id: patient, encounter_id: encounterId, code: 'height', value_num: '200', unit: 'cm', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[5], patient_id: patient, code: 'respiratory-rate', value_num: '26', unit: 'breaths/min', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
          { id: ids[6], patient_id: patient, code: 'spo2', value_num: '90', unit: '%', origin: 'local', taken_at: new Date('2026-10-14T10:00:00Z') },
        ]).execute();
        const chart = (await get(`staff/charts/${patient}`).expect(200)).body;
        const reading = (code: string) => chart.observations.items.find((item: {code: string}) => item.code === code);
        expect(reading('bp-systolic').assessment).toMatchObject({status: 'urgent', label: 'Severely high', ruleVersion: 'adult-screening-2026-10-15.v2'});
        expect(reading('bp-diastolic').assessment.status).toBe('not-flagged');
        expect(reading('temperature').assessment).toMatchObject({status: 'attention', label: 'High temperature'});
        expect(reading('heart-rate').assessment.status).toBe('not-flagged');
        expect(reading('respiratory-rate').assessment.status).toBe('urgent');
        expect(reading('spo2').assessment.status).toBe('urgent');
        expect(chart.observations.derived.find((item: {code: string}) => item.code === 'bmi')).toMatchObject({value:30, category:'Obesity class 1', sourceIds:[ids[3],ids[4]]});
        expect(chart.observations.derived.find((item: {code: string}) => item.code === 'map').value).toBe(110);
      } finally {
        await db.deleteFrom('clin.observation').where('id', 'in', ids).execute();
        await db.deleteFrom('encounter.encounter').where('id', '=', encounterId).execute();
      }
    });
    it('distinguishes missing clinical data from restricted sections', async () => {
      const empty = (await get(`staff/charts/${otherPatient}`).expect(200))
        .body;
      expect(empty.entries).toMatchObject({ access: 'available', items: [] });
      await db
        .updateTable('iam.membership')
        .set({ privileges: ['patient:read', 'patient:write'] })
        .where('person_id', '=', person)
        .where('facility_id', '=', facility)
        .execute();
      const restricted = (await get(`staff/charts/${patient}`).expect(200))
        .body;
      expect(restricted.observations).toMatchObject({
        access: 'restricted',
        items: [],
      });
      expect(restricted.entries).toMatchObject({
        access: 'restricted',
        items: [],
      });
    });
    it('blocks legacy facility spoofing and summary access without care', async () => {
      await get(`patients/search?q=Ade&facilityId=${foreign}`).expect(403);
      const unassigned = (
        await db
          .selectFrom('patient.patient')
          .select('id')
          .where('family_name', '=', 'Worklist-2')
          .where('facility_id', '=', facility)
          .executeTakeFirstOrThrow()
      ).id;
      await get(`patients/${unassigned}/summary`).expect(403);
      await get(`patients/${patient}/summary`).expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', org)
        .set('x-facility-id', facility)
        .send({
          familyName: 'Spoof',
          givenName: 'Synthetic',
          dateOfBirth: '1990-01-01',
          sex: 'F',
          facilityId: foreign,
        })
        .expect(403);
    });
    it('revoked assignments and membership immediately remove record access', async () => {
      await db
        .updateTable('iam.care_assignment')
        .set({ effective_to: new Date(0) })
        .where('person_id', '=', person)
        .where('patient_id', '=', patient)
        .execute();
      await get(`staff/charts/${patient}`).expect(403);
      await db
        .updateTable('iam.membership')
        .set({ effective_to: new Date(0) })
        .where('person_id', '=', person)
        .execute();
      await get('staff/patients').expect(403);
    });
  },
);
