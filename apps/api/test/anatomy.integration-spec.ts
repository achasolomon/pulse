import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyAnatomyRepository } from './../src/modules/anatomy/infrastructure/kysely-anatomy.repository.js';
import { AnatomyService } from './../src/modules/anatomy/application/anatomy.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { EncounterService } from './../src/modules/encounter/application/encounter.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36).toUpperCase();

const PERSON = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_PERSON = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe.skipIf(!hasDb)('anatomy finding lifecycle (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let anat: AnatomyService;
  let patientId: string;
  let otherPatientId: string;
  let encounterId: string;
  let otherEncounterId: string;
  let modelId: string;
  let systemStructureId: string;
  let regionStructureId: string;
  let structureId: string;
  let facilityId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    anat = new AnatomyService(new KyselyAnatomyRepository(db), outbox);

    const org = await db
      .insertInto('org.organization')
      .values({ name: `Anat Org ${RUN}`, code: `ANO${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Anat', code: 'AN' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;

    const patients = new PatientService(patientRepo, outbox);
    const reg = await patients.register({
      familyName: 'Anat',
      givenName: 'Pat',
      dateOfBirth: '1990-03-03',
      sex: 'F',
      facilityId,
      mrn: `AN${RUN}`,
    });
    patientId = reg.patient.id;
    const reg2 = await patients.register({
      familyName: 'Other',
      givenName: 'Pat',
      dateOfBirth: '1991-04-04',
      sex: 'M',
      facilityId,
      mrn: `OT${RUN}`,
    });
    otherPatientId = reg2.patient.id;

    const encounters = new EncounterService(
      new KyselyEncounterRepository(db),
      patientRepo,
      outbox,
    );
    const enc = await encounters.open({ patientId, facilityId, type: 'outpatient' });
    encounterId = enc.id;
    const enc2 = await encounters.open({ patientId: otherPatientId, facilityId, type: 'outpatient' });
    otherEncounterId = enc2.id;

    const model = await anat.createModel({
      vendor: 'pulse-demo',
      modelName: `adult_${RUN}`,
      version: '1.0',
      status: 'active',
      licence: 'demo-licence',
    });
    modelId = model.id;
    const sys = await anat.createStructure({
      modelId,
      vendorStructureKey: 'msk',
      level: 'system',
      name: 'Musculoskeletal',
      code: 'MSK',
    });
    systemStructureId = sys.id;
    const regn = await anat.createStructure({
      modelId,
      vendorStructureKey: 'lower_limb',
      parentStructureId: sys.id,
      level: 'region',
      name: 'Lower limb',
      code: 'LL',
    });
    regionStructureId = regn.id;
    const femur = await anat.createStructure({
      modelId,
      vendorStructureKey: 'femur',
      parentStructureId: regn.id,
      level: 'structure',
      name: 'Femur',
      code: 'FEM',
    });
    structureId = femur.id;
    await anat.createMapping({
      structureId,
      codingSystem: 'snomed',
      code: '15771000',
      codeVersion: '2025-09',
      approved: true,
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  const base = () => ({
    patientId,
    encounterId,
    facilityId,
    anatomyModelId: modelId,
    anatomyStructureId: structureId,
    findingType: 'pain',
    authorId: PERSON,
  });

  const eventsFor = async (aggregateId: string) =>
    (
      await db
        .selectFrom('integration.outbox')
        .select(['type'])
        .where('aggregate_id', '=', aggregateId)
        .execute()
    ).map((e) => e.type);

  it('catalogue builds a hierarchy with mapping; full draft lifecycle persists with events', async () => {
    const structures = await anat.listStructures(modelId);
    expect(structures.length).toBe(3);
    expect(structures.find((s) => s.id === systemStructureId)?.parentStructureId).toBeNull();
    expect(structures.find((s) => s.id === regionStructureId)?.parentStructureId).toBe(
      systemStructureId,
    );
    const detail = await anat.getStructure(structureId);
    expect(detail.parentStructureId).toBe(regionStructureId);
    expect(detail.mappings.map((m) => m.codingSystem)).toContain('snomed');

    const draft = await anat.createFinding({
      ...base(),
      laterality: 'left',
      findingText: 'dull ache over lateral thigh',
      severity: 'mild',
      geometry: [{ kind: 'point', x: 0.42, y: 0.61 }],
      clientRef: `REF-${RUN}`,
    });
    expect(draft.status).toBe('draft');
    expect(draft.version).toBe(1);
    expect(await eventsFor(draft.id)).toContain('anatomy.finding_drafted');

    // idempotent create via clientRef
    const again = await anat.createFinding({ ...base(), clientRef: `REF-${RUN}` });
    expect(again.id).toBe(draft.id);

    const v2 = await anat.updateDraft(draft.id, {
      expectedVersion: 1,
      findingText: 'dull ache, 3/10',
      geometry: [{ kind: 'point', x: 0.43, y: 0.62 }],
    });
    expect(v2?.version).toBe(2);

    const signed = await anat.sign(draft.id, { signedBy: PERSON });
    expect(signed.status).toBe('signed');
    expect(signed.signedBy).toBe(PERSON);
    expect(await eventsFor(draft.id)).toContain('anatomy.finding_signed');

    const amended = await anat.amend(draft.id, {
      amendmentReason: 'severity under-called',
      authorId: OTHER_PERSON,
      severity: 'moderate',
    });
    expect(amended.amendsId).toBe(draft.id);
    expect(amended.status).toBe('draft');
    expect(await eventsFor(draft.id)).toContain('anatomy.finding_amended');
    const prior = await anat.getFinding(draft.id);
    expect(prior.status).toBe('amended');

    const errored = await anat.enterError(amended.id, {
      reason: 'documented against wrong encounter, superseded',
    });
    expect(errored.status).toBe('entered_in_error');
    expect(await eventsFor(amended.id)).toContain('anatomy.finding_entered_in_error');

    // clinical link (same patient)
    const link = await anat.linkFinding(draft.id, { targetType: 'encounter', targetId: encounterId });
    expect(link.findingId).toBe(draft.id);
    expect(await eventsFor(draft.id)).toContain('anatomy.finding_linked');

    const findings = await anat.listFindings({ patientId, facilityId });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.map((f) => f.id)).toContain(draft.id);
  });

  it('safety rejections: laterality, non-active model, cross-patient encounter/link', async () => {
    const noLatDraft = await anat.createFinding({ ...base(), findingText: 'no side recorded' });
    await expect(anat.sign(noLatDraft.id, { signedBy: PERSON })).rejects.toThrow(
      'Laterality is required to sign',
    );

    const retired = await anat.createModel({
      vendor: 'pulse-demo',
      modelName: `retired_${RUN}`,
      version: '1.0',
      status: 'retired',
    });
    await expect(
      anat.createFinding({ ...base(), anatomyModelId: retired.id }),
    ).rejects.toThrow('New annotations require an active model');

    await expect(
      anat.createFinding({ ...base(), encounterId: otherEncounterId }),
    ).rejects.toThrow('Encounter does not belong to the patient');

    const draft = await anat.createFinding({ ...base(), laterality: 'midline' });
    const otherObs = await db
      .insertInto('clin.observation')
      .values({
        patient_id: otherPatientId,
        encounter_id: otherEncounterId,
        code: 'heart-rate',
        value_num: 72,
        unit: 'bpm',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    await expect(
      anat.linkFinding(draft.id, { targetType: 'observation', targetId: otherObs.id }),
    ).rejects.toThrow('Link target belongs to a different patient');
  });
});
