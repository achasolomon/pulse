import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyAppointmentRepository } from './../src/modules/scheduling/infrastructure/kysely-appointment.repository.js';
import { SchedulingService } from './../src/modules/scheduling/application/scheduling.service.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { ClinicalService } from './../src/modules/clinical/application/clinical.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

/** Full R1 visit chain: book -> check-in -> register -> open -> vitals -> note -> sign -> entry -> timeline. */
describe.skipIf(!hasDb)('first vertical slice (integration)', () => {
  let db: Kysely<PulseDatabase>;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('completes the visit chain', async () => {
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    const patients = new PatientService(patientRepo, outbox);
    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const scheduling = new SchedulingService(
      new KyselyAppointmentRepository(db),
      outbox,
    );
    const clinical = new ClinicalService(
      new KyselyClinicalRepository(db),
      outbox,
    );

    const code = `V${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Visit Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Clinic', code: 'CL' })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const reg = await patients.register({
      familyName: 'Adeyemi',
      givenName: 'Tunde',
      dateOfBirth: '1988-04-04',
      sex: 'M',
      facilityId: fac.id,
      mrn: `V${Date.now()}`,
    });
    const appt = await scheduling.book({
      patientId: reg.patient.id,
      facilityId: fac.id,
      scheduledAt: new Date().toISOString(),
      reason: 'Follow-up - Hypertension',
    });
    await scheduling.checkIn(appt.id, {});
    const queue = await new KyselyAppointmentRepository(db).queue(fac.id, 50);
    expect(queue.some((a) => a.id === appt.id)).toBe(true);

    const enc = await encounters.open({
      patientId: reg.patient.id,
      facilityId: fac.id,
      type: 'outpatient',
    });
    await clinical.recordVitals({
      observations: [
        { patientId: reg.patient.id, encounterId: enc.id, code: 'BP_SYS', valueNum: 130, unit: 'mmHg' },
        { patientId: reg.patient.id, encounterId: enc.id, code: 'BP_DIA', valueNum: 85, unit: 'mmHg' },
      ],
    });
    const note = await clinical.draftNote({
      patientId: reg.patient.id,
      encounterId: enc.id,
      chiefComplaint: 'Follow-up - hypertension',
      assessment: 'BP controlled',
      history: '',
      examination: '',
      plan: 'Continue meds',
    });
    const signed = await clinical.signNote(note.id, {});
    expect(signed.status).toBe('signed');
    await expect(clinical.signNote(note.id, {})).rejects.toThrow();
    await clinical.addAddendum(note.id, 'Correction: home readings 130/80.');
    await clinical.recordEntry({
      patientId: reg.patient.id,
      encounterId: enc.id,
      kind: 'problem',
      display: 'Hypertension',
    });
    const timeline = await new KyselyClinicalRepository(db).timeline(reg.patient.id, 50);
    const kinds = timeline.map((t) => t.kind);
    for (const k of ['encounter', 'note', 'observation', 'entry', 'appointment'] as const) {
      expect(kinds).toContain(k);
    }
  });
});
