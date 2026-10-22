import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'outpatient role handoffs on PostgreSQL',
  () => {
    let app: INestApplication,
      db: Pool,
      org: string,
      facility: string,
      foreign: string,
      patient: string,
      visit: string;
    const people = {
      records: randomUUID(),
      reception: randomUUID(),
      nurse: randomUUID(),
      otherNurse: randomUUID(),
      doctor: randomUUID(),
      blocked: randomUUID(),
    };
    const tokens: Record<string, string> = {};
    beforeAll(async () => {
      if (new URL(process.env.DATABASE_URL!).port !== '5437')
        throw new Error('Use the disposable review database on port 5437');
      db = new Pool({ connectionString: process.env.DATABASE_URL });
      org = (
        await db.query(
          'INSERT INTO org.organization(name,code)VALUES($1,$2)RETURNING id',
          ['Outpatient synthetic test', randomUUID()],
        )
      ).rows[0].id;
      facility = (
        await db.query(
          'INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',
          [org, 'Synthetic outpatient hospital', 'FLOW'],
        )
      ).rows[0].id;
      foreign = (
        await db.query(
          'INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',
          [org, 'Synthetic foreign hospital', 'OTHER'],
        )
      ).rows[0].id;
      const privileges: Record<string, string[]> = {
        records: ['patient:read', 'patient:write'],
        reception: [
          'patient:read',
          'appointment:read',
          'appointment:check-in',
          'encounter:read',
          'encounter:write',
        ],
        nurse: [
          'patient:read',
          'observation:read',
          'observation:write',
          'entry:read',
          'encounter:read',
        ],
        otherNurse: [
          'patient:read',
          'observation:read',
          'observation:write',
          'encounter:read',
        ],
        doctor: [
          'patient:read',
          'observation:read',
          'entry:read',
          'encounter:read',
          'encounter:consult',
        ],
        blocked: ['patient:read'],
      };
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = configureApp(module.createNestApplication());
      await app.init();
      const auth = app.get(StaffAuthService);
      for (const [role, personId] of Object.entries(people)) {
        await db.query(
          'INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',
          [personId, org, facility, [role], privileges[role]],
        );
        const loginId = `flow-${role}-${randomUUID()}`,
          secret = randomUUID();
        await auth.register({ personId, loginId, secret });
        tokens[role] = (await auth.login({ loginId, secret })).token;
      }
    });
    afterAll(async () => {
      await app?.close();
      await db?.end();
    });
    function call(actor: string, path: string, body?: unknown, fac = facility) {
      const req = request(app.getHttpServer());
      return (
        body === undefined
          ? req.get(`/api/v1/${path}`)
          : req.post(`/api/v1/${path}`).send(body)
      )
        .set('Authorization', `Bearer ${tokens[actor]}`)
        .set('x-tenant-id', org)
        .set('x-facility-id', fac);
    }
    it('registers once, assigns an MRN and explicitly reviews exact duplicates', async () => {
      const input = {
        givenName: 'Synthetic',
        familyName: 'Outpatient',
        dateOfBirth: '1990-01-15',
        sex: 'F',
        phone: '0000000000',
        commandKey: randomUUID(),
      };
      const [a, b] = await Promise.all([
        call('records', 'staff/patients/register', input),
        call('records', 'staff/patients/register', input),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body).toEqual(b.body);
      patient = a.body.patientId;
      expect(a.body.mrn).toMatch(/^P-FLOW-/);
      await call('records', 'staff/patients/register', {
        ...input,
        givenName: 'Changed',
      }).expect(409);
      const duplicate = await call('records', 'staff/patients/register', {
        ...input,
        commandKey: randomUUID(),
      }).expect(201);
      expect(duplicate.body.kind).toBe('duplicate-review');
      expect(duplicate.body.candidates[0].id).toBe(patient);
      await call('reception', 'staff/patients/register', {
        ...input,
        commandKey: randomUUID(),
      }).expect(403);
      await call('records', 'staff/patients/register', {
        ...input,
        dateOfBirth: '2026-02-30',
        commandKey: randomUUID(),
      }).expect(400);
      expect(
        (
          await db.query(
            'SELECT count(*) FROM patient.patient WHERE facility_id=$1',
            [facility],
          )
        ).rows[0].count,
      ).toBe('1');
    });
    it('checks in one active visit and exposes it in the nurse queue', async () => {
      const [a, b] = await Promise.all([
        call('reception', 'staff/visits/check-in', {
          patientId: patient,
          commandKey: randomUUID(),
        }),
        call('reception', 'staff/visits/check-in', {
          patientId: patient,
          commandKey: randomUUID(),
        }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);
      visit = a.body.id;
      expect(a.body.stage).toBe('waiting-vitals');
      expect(
        (await call('nurse', 'staff/visits?queue=vitals').expect(200)).body.map(
          (v: { id: string }) => v.id,
        ),
      ).toContain(visit);
      await call('nurse', `staff/charts/${patient}`).expect(403);
      await call('blocked', 'staff/visits/check-in', {
        patientId: patient,
        commandKey: randomUUID(),
      }).expect(403);
      await call('reception', 'staff/visits/check-in', {
        patientId: patient,
        appointmentId: randomUUID(),
        commandKey: randomUUID(),
      }).expect(409);
      await call(
        'reception',
        'staff/visits/check-in',
        { patientId: patient, commandKey: randomUUID() },
        foreign,
      ).expect(403);
    });
    it('claims exclusively and grants chart access only to the assigned nurse', async () => {
      await call('nurse', `staff/visits/${visit}/handoff`, {
        clinicianId: people.doctor,
        commandKey: randomUUID(),
      }).expect(409);
      const key = randomUUID();
      const claimed = await call('nurse', `staff/visits/${visit}/claim`, {
        commandKey: key,
      }).expect(201);
      expect(claimed.body.nursePersonId).toBe(people.nurse);
      await call('nurse', `staff/visits/${visit}/claim`, {
        commandKey: key,
      }).expect(201);
      await call('otherNurse', `staff/visits/${visit}/claim`, {
        commandKey: randomUUID(),
      }).expect(409);
      await call('nurse', `staff/charts/${patient}`).expect(200);
      await call('otherNurse', `staff/charts/${patient}`).expect(403);
    });
    it('records real observations atomically without duplicating a retry', async () => {
      const input = {
        measurements: [
          { code: 'heart-rate', value: 72 },
          { code: 'bp-systolic', value: 120 },
          { code: 'bp-diastolic', value: 80 },
        ],
        takenAt: new Date().toISOString(),
        commandKey: randomUUID(),
      };
      await call('otherNurse', `staff/visits/${visit}/vitals`, input).expect(
        409,
      );
      await call('nurse', `staff/visits/${visit}/vitals`, {
        ...input,
        measurements: [{ code: 'bp-systolic', value: 120 }],
        commandKey: randomUUID(),
      }).expect(400);
      await call('nurse', `staff/visits/${visit}/vitals`, {
        ...input,
        measurements: [{ code: 'spo2', value: 101 }],
        commandKey: randomUUID(),
      }).expect(400);
      await call('nurse', `staff/visits/${visit}/vitals`, input).expect(201);
      await call('nurse', `staff/visits/${visit}/vitals`, input).expect(201);
      const observations = (
        await db.query(
          'SELECT code,value_num,recorded_by FROM clin.observation WHERE patient_id=$1',
          [patient],
        )
      ).rows;
      expect(observations).toHaveLength(3);
      expect(observations.every((o) => o.recorded_by === people.nurse)).toBe(
        true,
      );
      const chart = await call('nurse', `staff/charts/${patient}`).expect(200);
      expect(chart.body.observations.items).toHaveLength(3);
      expect(
        (await call('nurse', `staff/visits/${visit}`).expect(200)).body.stage,
      ).toBe('vitals-recorded');
      expect(
        (
          await db.query(
            'SELECT count(*) FROM integration.outbox WHERE aggregate_id IN (SELECT id FROM clin.observation WHERE patient_id=$1)',
            [patient],
          )
        ).rows[0].count,
      ).toBe('3');
    });
    it('hands off to eligible staff and opens only their consultation queue', async () => {
      await call('nurse', `staff/visits/${visit}/handoff`, {
        clinicianId: people.blocked,
        commandKey: randomUUID(),
      }).expect(409);
      const key = randomUUID();
      const handoff = await call('nurse', `staff/visits/${visit}/handoff`, {
        clinicianId: people.doctor,
        commandKey: key,
      }).expect(201);
      expect(handoff.body.stage).toBe('waiting-consultation');
      await call('nurse', `staff/visits/${visit}/handoff`, {
        clinicianId: people.doctor,
        commandKey: key,
      }).expect(201);
      await call('nurse', `staff/visits/${visit}/vitals`, {
        measurements: [{ code: 'heart-rate', value: 80 }],
        takenAt: new Date().toISOString(),
        commandKey: randomUUID(),
      }).expect(409);
      expect(
        (await call('nurse', 'staff/visits?queue=vitals').expect(200)).body,
      ).toHaveLength(0);
      expect(
        (await call('doctor', 'staff/visits?queue=consultation').expect(200))
          .body[0].id,
      ).toBe(visit);
      await call('doctor', `staff/charts/${patient}`).expect(200);
      const started = await call('doctor', `staff/visits/${visit}/start`, {
        commandKey: randomUUID(),
      }).expect(201);
      expect(started.body.stage).toBe('in-consultation');
    });
    it('uses latest membership for eligible consultation staff and rejects revoked access', async () => {
      await db.query(
        "INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges,created_at)VALUES($1,$2,$3,ARRAY['doctor'],ARRAY['patient:read'],now()+interval '1 second')",
        [people.doctor, org, facility],
      );
      expect(
        (await call('nurse', 'staff/visits/clinicians').expect(200)).body,
      ).toHaveLength(0);
      await call('doctor', 'staff/visits?queue=consultation').expect(403);
      await db.query(
        'UPDATE iam.membership SET effective_to=now() WHERE person_id=$1',
        [people.nurse],
      );
      await call('nurse', `staff/charts/${patient}`).expect(403);
    });
    it('reviews surname/date-of-birth matches and requires explicit separate registration', async () => {
      const input = {
        givenName: 'Different given name',
        familyName: 'Outpatient',
        dateOfBirth: '1990-01-15',
        sex: 'F',
        commandKey: randomUUID(),
      };
      const review = await call(
        'records',
        'staff/patients/register',
        input,
      ).expect(201);
      expect(review.body.kind).toBe('duplicate-review');
      const confirmed = await call('records', 'staff/patients/register', {
        ...input,
        confirmDuplicate: true,
        commandKey: randomUUID(),
      }).expect(201);
      expect(confirmed.body.kind).toBe('registered');
      expect(confirmed.body.patientId).not.toBe(patient);
      const retry = await call(
        'records',
        'staff/patients/register',
        input,
      ).expect(201);
      expect(retry.body.kind).toBe('duplicate-review');
    });
    it('rejects foreign patient/encounter scope on legacy routes and the new check-in', async () => {
      const foreignPatient = (
        await db.query(
          "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic','Foreign','1990-01-15','F',$1)RETURNING id",
          [foreign],
        )
      ).rows[0].id;
      const enc = (
        await db.query(
          "INSERT INTO encounter.encounter(patient_id,facility_id,type)VALUES($1,$2,'outpatient')RETURNING id",
          [foreignPatient, foreign],
        )
      ).rows[0].id;
      await call('reception', 'staff/visits/check-in', {
        patientId: foreignPatient,
        commandKey: randomUUID(),
      }).expect(404);
      await call('reception', `encounters/${enc}`).expect(404);
      await call('reception', 'encounters', {
        patientId: foreignPatient,
        facilityId: facility,
        type: 'outpatient',
      }).expect(403);
      await call('reception', 'encounters', {
        patientId: foreignPatient,
        facilityId: foreign,
        type: 'outpatient',
      }).expect(403);
    });
    it('rejects revoked care and keeps legacy vitals from bypassing the outpatient flow', async () => {
      const registration = await call('records', 'staff/patients/register', {
        givenName: 'Synthetic',
        familyName: 'Revocation',
        dateOfBirth: '1990-01-15',
        sex: 'F',
        commandKey: randomUUID(),
      }).expect(201);
      const checked = await call('reception', 'staff/visits/check-in', {
        patientId: registration.body.patientId,
        commandKey: randomUUID(),
      }).expect(201);
      await call('otherNurse', `staff/visits/${checked.body.id}/claim`, {
        commandKey: randomUUID(),
      }).expect(201);
      await call('otherNurse', 'clinical/vitals', {
        observations: [
          {
            patientId: registration.body.patientId,
            encounterId: checked.body.encounterId,
            code: 'heart-rate',
            valueNum: 72,
            unit: 'bpm',
          },
        ],
      }).expect(409);
      await db.query(
        'UPDATE iam.care_assignment SET effective_to=now() WHERE patient_id=$1 AND person_id=$2',
        [registration.body.patientId, people.otherNurse],
      );
      await call('otherNurse', `staff/visits/${checked.body.id}/vitals`, {
        measurements: [{ code: 'heart-rate', value: 72 }],
        takenAt: new Date().toISOString(),
        commandKey: randomUUID(),
      }).expect(409);
      await call(
        'otherNurse',
        `staff/charts/${registration.body.patientId}`,
      ).expect(403);
      expect(
        (
          await db.query(
            'SELECT count(*) FROM clin.observation WHERE patient_id=$1',
            [registration.body.patientId],
          )
        ).rows[0].count,
      ).toBe('0');
    });
  },
);
