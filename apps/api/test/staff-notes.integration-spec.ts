import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/platform/bootstrap.js';
import { StaffAuthService } from '../src/modules/iam/application/staff-auth.service.js';
describe.skipIf(!process.env.DATABASE_URL)(
  'staff clinical note lifecycle',
  () => {
    let app: INestApplication,
      db: Pool,
      org: string,
      facility: string,
      foreign: string,
      patient: string,
      encounter: string,
      noteId: string;
    const people = {
      reception: randomUUID(),
      nurse: randomUUID(),
      doctor: randomUUID(),
      other: randomUUID(),
      reader: randomUUID(),
    };
    const tokens: Record<string, string> = {};
    let version = 1;
    const body = {
      chiefComplaint: 'Synthetic follow-up',
      history: 'Synthetic history',
      examination: 'Synthetic examination',
      assessment: 'Synthetic assessment',
      plan: 'Synthetic care plan',
    };
    const richText={history:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Synthetic history',marks:[{type:'bold'}]}]}]}};
    beforeAll(async () => {
      if (new URL(process.env.DATABASE_URL!).port !== '5437')
        throw new Error('Use disposable PostgreSQL on port 5437');
      db = new Pool({ connectionString: process.env.DATABASE_URL });
      org = (
        await db.query(
          'INSERT INTO org.organization(name,code)VALUES($1,$2)RETURNING id',
          ['Notes synthetic group', randomUUID()],
        )
      ).rows[0].id;
      async function fac(code: string) {
        return (
          await db.query(
            'INSERT INTO org.facility(organization_id,name,code)VALUES($1,$2,$3)RETURNING id',
            [org, 'Notes synthetic hospital', code],
          )
        ).rows[0].id;
      }
      facility = await fac('NOTES');
      foreign = await fac('FOREIGN');
      patient = (
        await db.query(
          "INSERT INTO patient.patient(given_name,family_name,date_of_birth,sex,facility_id)VALUES('Synthetic','Notes','1990-01-15','F',$1)RETURNING id",
          [facility],
        )
      ).rows[0].id;
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = configureApp(module.createNestApplication());
      await app.init();
      const auth = app.get(StaffAuthService);
      const notes = ['note:read', 'note:write', 'note:sign', 'note:amend'];
      const grants: Record<string, string[]> = {
        reception: ['patient:read', 'encounter:write', 'appointment:check-in'],
        nurse: [
          'patient:read',
          'observation:write',
          'encounter:read',
          'note:nursing',
          ...notes,
        ],
        doctor: [
          'patient:read',
          'encounter:read',
          'encounter:consult',
          ...notes,
        ],
        other: [
          'patient:read',
          'encounter:read',
          'encounter:consult',
          ...notes,
        ],
        reader: ['patient:read', 'note:read'],
      };
      for (const [role, personId] of Object.entries(people)) {
        await db.query(
          'INSERT INTO iam.membership(person_id,organization_id,facility_id,roles,privileges)VALUES($1,$2,$3,$4,$5)',
          [personId, org, facility, [role], grants[role]],
        );
        const loginId = `notes-${role}-${randomUUID()}`,
          secret = randomUUID();
        await auth.register({ personId, loginId, secret });
        tokens[role] = (await auth.login({ loginId, secret })).token;
      }
      const checked = await call('reception', 'staff/visits/check-in', {
        patientId: patient,
        commandKey: randomUUID(),
      }).expect(201);
      const visit = checked.body.id;
      encounter = checked.body.encounterId;
      await call('nurse', `staff/visits/${visit}/claim`, {
        commandKey: randomUUID(),
      }).expect(201);
      await call('nurse', `staff/visits/${visit}/vitals`, {
        measurements: [{ code: 'heart-rate', value: 72 }],
        takenAt: new Date().toISOString(),
        commandKey: randomUUID(),
      }).expect(201);
      await call('nurse', `staff/visits/${visit}/handoff`, {
        clinicianId: people.doctor,
        commandKey: randomUUID(),
      }).expect(201);
      await call('doctor', `staff/visits/${visit}/start`, {
        commandKey: randomUUID(),
      }).expect(201);
      for (const actor of ['reader', 'other'] as const)
        await db.query(
          "INSERT INTO iam.care_assignment(person_id,patient_id,facility_id,encounter_id,kind)VALUES($1,$2,$3,$4,'synthetic-note-read')",
          [people[actor], patient, facility, encounter],
        );
    });
    afterAll(async () => {
      await app?.close();
      await db?.end();
    });
    function call(
      actor: string,
      path: string,
      input?: unknown,
      fac = facility,
    ) {
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
    it('offers only active assigned note contexts and rejects other staff despite patient care access', async () => {
      expect(
        (
          await call(
            'doctor',
            `staff/patients/${patient}/note-contexts`,
          ).expect(200)
        ).body[0].kinds,
      ).toEqual(['consultation']);
      expect(
        (
          await call('nurse', `staff/patients/${patient}/note-contexts`).expect(
            200,
          )
        ).body[0].kinds,
      ).toEqual(['nursing']);
      expect(
        (
          await call('other', `staff/patients/${patient}/note-contexts`).expect(
            200,
          )
        ).body,
      ).toHaveLength(0);
      await call('other', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'consultation',
        commandKey: randomUUID(),
      }).expect(403);
      await call('doctor', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'nursing',
        commandKey: randomUUID(),
      }).expect(403);
      await call('doctor', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'consultation',
        authorId: people.other,
        commandKey: randomUUID(),
      }).expect(400);
    });
    it('creates retry-safe attributed drafts and hides them from other readers', async () => {
      const input = {
        ...body,
        richText,
        encounterId: encounter,
        kind: 'consultation',
        commandKey: randomUUID(),
      };
      const [a, b] = await Promise.all([
        call('doctor', `staff/patients/${patient}/notes`, input),
        call('doctor', `staff/patients/${patient}/notes`, input),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);
      noteId = a.body.id;
      expect(a.body).toMatchObject({
        authorId: people.doctor,
        status: 'draft',
        version: 1,
        kind: 'consultation',
      });
      await call('doctor', `staff/patients/${patient}/notes`, {
        ...input,
        plan: 'Changed payload',
      }).expect(409);
      await call('reader', `staff/notes/${noteId}`).expect(404);
      await call('other', `staff/notes/${noteId}`).expect(404);
      const visible = await call(
        'reader',
        `staff/charts/${patient}/history/notes`,
      ).expect(200);
      expect(visible.body.items).toHaveLength(0);
      expect(
        (
          await db.query(
            "SELECT count(*) FROM integration.outbox WHERE aggregate_id=$1 AND type='note.drafted'",
            [noteId],
          )
        ).rows[0].count,
      ).toBe('1');
    });
    it('resumes drafts, rejects stale edits and serializes competing revisions', async () => {
      const read = await call('doctor', `staff/notes/${noteId}`).expect(200);
      expect(read.body.richText).toEqual(richText);
      expect(read.headers['cache-control']).toBe('no-store');
      const [a, b] = await Promise.all([
        call('doctor', `staff/notes/${noteId}/save`, {
          ...body,
          plan: 'First concurrent edit',
          expectedVersion: 1,
          commandKey: randomUUID(),
        }),
        call('doctor', `staff/notes/${noteId}/save`, {
          ...body,
          plan: 'Second concurrent edit',
          expectedVersion: 1,
          commandKey: randomUUID(),
        }),
      ]);
      expect([a.status, b.status].sort((left, right) => left - right)).toEqual([
        201, 409,
      ]);
      version = 2;
      await call('doctor', `staff/notes/${noteId}/save`, {
        ...body,
        expectedVersion: 1,
        commandKey: randomUUID(),
      }).expect(409);
      await call('other', `staff/notes/${noteId}/save`, {
        ...body,
        expectedVersion: version,
        commandKey: randomUUID(),
      }).expect(404);
      const input = {
        ...body,
        richText,
        expectedVersion: version,
        commandKey: randomUUID(),
      };
      const saved = await call(
        'doctor',
        `staff/notes/${noteId}/save`,
        input,
      ).expect(201);
      version = saved.body.version;
      const retry = await call(
        'doctor',
        `staff/notes/${noteId}/save`,
        input,
      ).expect(201);
      expect(retry.body.version).toBe(version);
    });
    it('requires reviewed current content and makes signing immutable and retry-safe', async () => {
      await call('doctor', `staff/notes/${noteId}/save`, {...body,richText:{history:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Different narrative'}]}]}},expectedVersion:version,commandKey:randomUUID()}).expect(400);
      await call('doctor', `staff/notes/${noteId}/save`, {...body,richText:{history:{type:'doc',content:[{type:'image',attrs:{src:'javascript:bad'}}]}},expectedVersion:version,commandKey:randomUUID()}).expect(400);
      await call('doctor', `staff/notes/${noteId}/sign`, {
        expectedVersion: version,
        attestation: false,
        commandKey: randomUUID(),
      }).expect(400);
      await call('doctor', `staff/notes/${noteId}/sign`, {
        expectedVersion: 1,
        attestation: true,
        commandKey: randomUUID(),
      }).expect(409);
      const input = {
        expectedVersion: version,
        attestation: true,
        commandKey: randomUUID(),
      };
      const signed = await call(
        'doctor',
        `staff/notes/${noteId}/sign`,
        input,
      ).expect(201);
      expect(signed.body.status).toBe('signed');
      expect(signed.body.richText).toEqual(richText);
      expect(signed.body.signedAt).toBeTruthy();
      version = signed.body.version;
      await call('doctor', `staff/notes/${noteId}/sign`, input).expect(201);
      await call('doctor', `staff/notes/${noteId}/save`, {
        ...body,
        expectedVersion: version,
        commandKey: randomUUID(),
      }).expect(409);
      await expect(
        db.query("UPDATE clin.note SET plan='Forbidden overwrite'WHERE id=$1", [
          noteId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(db.query("UPDATE clin.note SET rich_text='{}'::jsonb WHERE id=$1",[noteId])).rejects.toMatchObject({code:'23514'});
      expect(
        (await call('reader', `staff/notes/${noteId}`).expect(200)).body.plan,
      ).toBe(body.plan);
    });
    it('appends attributed addenda once without altering signed content', async () => {
      await call('other', `staff/notes/${noteId}/addenda`, {
        text: 'Unauthorized correction',
        commandKey: randomUUID(),
      }).expect(404);
      const before = (await call('doctor', `staff/notes/${noteId}`).expect(200))
        .body;
      const input = {
        text: 'Synthetic attributed clarification',
        commandKey: randomUUID(),
      };
      await call('doctor', `staff/notes/${noteId}/addenda`, input).expect(201);
      const after = (
        await call('doctor', `staff/notes/${noteId}/addenda`, input).expect(201)
      ).body;
      expect(after.addenda).toHaveLength(1);
      expect(after.addenda[0]).toMatchObject({
        text: input.text,
        authorId: people.doctor,
      });
      expect(after.plan).toBe(before.plan);
      expect(after.signedAt).toBe(before.signedAt);
      expect(after.version).toBe(before.version);
      const events = (
        await db.query(
          'SELECT payload FROM integration.outbox WHERE aggregate_id=$1',
          [noteId],
        )
      ).rows;
      expect(JSON.stringify(events)).not.toContain(body.plan);
      expect(JSON.stringify(events)).not.toContain(input.text);
    });
    it('supports nursing notes after handoff and rejects unsigned addenda and blank-content signing', async () => {
      const created = await call('nurse', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'nursing',
        history: '',
        examination: '',
        assessment: '',
        plan: '',
        commandKey: randomUUID(),
      }).expect(201);
      const id = created.body.id;
      expect(created.body.authorId).toBe(people.nurse);
      await call('nurse', `staff/notes/${id}/addenda`, {
        text: 'Not signed yet',
        commandKey: randomUUID(),
      }).expect(409);
      await call('nurse', `staff/notes/${id}/sign`, {
        expectedVersion: 1,
        attestation: true,
        commandKey: randomUUID(),
      }).expect(400);
      const saved = await call('nurse', `staff/notes/${id}/save`, {
        ...body,
        history: 'Nursing care observations',
        expectedVersion: 1,
        commandKey: randomUUID(),
      }).expect(201);
      await call('nurse', `staff/notes/${id}/sign`, {
        expectedVersion: saved.body.version,
        attestation: true,
        commandKey: randomUUID(),
      }).expect(201);
    });
    it('rejects legacy note routes as a staff-authenticated bypass and scopes all reads', async () => {
      await call('doctor', 'clinical/notes', {
        patientId: patient,
        encounterId: encounter,
        chiefComplaint: 'Bypass',
      }).expect(409);
      await call('doctor', `clinical/notes/${noteId}/sign`, {}).expect(409);
      await call('doctor', `clinical/notes/${noteId}/addenda`, {
        text: 'Bypass addendum',
      }).expect(409);
      await call('doctor', `staff/notes/${noteId}`, undefined, foreign).expect(
        403,
      );
      await call('reader', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'consultation',
        commandKey: randomUUID(),
      }).expect(403);
      const audit = (
        await db.query(
          'SELECT metadata FROM audit.audit_event WHERE resource_id=$1',
          [noteId],
        )
      ).rows;
      expect(JSON.stringify(audit)).not.toContain(body.history);
    });
    it('denies new documentation after encounter closure and denies amendments after care revocation', async () => {
      await db.query(
        "UPDATE encounter.encounter SET status='discharged',ended_at=now()WHERE id=$1",
        [encounter],
      );
      await call('doctor', `staff/patients/${patient}/notes`, {
        ...body,
        encounterId: encounter,
        kind: 'consultation',
        commandKey: randomUUID(),
      }).expect(403);
      await call('doctor', `staff/notes/${noteId}/addenda`, {
        text: 'Post-discharge clarification',
        commandKey: randomUUID(),
      }).expect(201);
      await db.query(
        'UPDATE iam.care_assignment SET effective_to=now()WHERE person_id=$1',
        [people.doctor],
      );
      await call('doctor', `staff/notes/${noteId}/addenda`, {
        text: 'Revoked assignment',
        commandKey: randomUUID(),
      }).expect(403);
      await call('doctor', `staff/notes/${noteId}`).expect(404);
      await db.query(
        'UPDATE iam.membership SET effective_to=now()WHERE person_id=$1',
        [people.nurse],
      );
      await call('nurse', `staff/patients/${patient}/note-contexts`).expect(
        403,
      );
    });
  },
);
