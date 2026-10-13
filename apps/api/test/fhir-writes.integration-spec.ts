import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { ExternalImportService } from './../src/modules/fhir/application/external-import.service.js';
import { FhirService } from './../src/modules/fhir/application/fhir.service.js';
import {
  KyselyExternalResourceRepository,
} from './../src/modules/fhir/infrastructure/external-resource.repository.js';
import {
  KyselyPartnerRepository,
  hashApiKey,
} from './../src/modules/fhir/infrastructure/partner.repository.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { KyselyEncounterRepository } from './../src/modules/encounter/infrastructure/kysely-encounter.repository.js';
import { KyselyClinicalRepository } from './../src/modules/clinical/infrastructure/kysely-clinical.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36).toUpperCase();

const statusOf = async (p: Promise<unknown>): Promise<number | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { status?: number }).status;
  }
};

const caught = async (
  p: Promise<unknown>,
): Promise<{ status?: number; message?: string } | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as { status?: number; message?: string };
  }
};

describe.skipIf(!hasDb)('FHIR writes + HL7v2 adapter (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let svc: ExternalImportService;
  let fhir: FhirService;
  let patientId: string;
  let mrn: string;
  let encounterId: string;
  let partnerId: string;

  const condition = (pid: string, encId?: string) => ({
    resourceType: 'Condition',
    subject: { reference: `Patient/${pid}` },
    ...(encId ? { context: { encounter: { reference: `Encounter/${encId}` } } } : {}),
    clinicalStatus: { coding: [{ code: 'active' }] },
    code: { coding: [{ code: `C${RUN}` }], text: `Asthma ${RUN}` },
  });

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    const patientRepo = new KyselyPatientRepository(db);
    const encounterRepo = new KyselyEncounterRepository(db);
    const clinicalRepo = new KyselyClinicalRepository(db);
    const partnerRepo = new KyselyPartnerRepository(db);
    svc = new ExternalImportService(
      new KyselyExternalResourceRepository(db),
      patientRepo,
      encounterRepo,
      clinicalRepo,
      partnerRepo,
      outbox,
    );
    fhir = new FhirService(patientRepo, encounterRepo, partnerRepo, db);

    const org = await db
      .insertInto('org.organization')
      .values({ name: `FhirW Org ${RUN}`, code: `FWO${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'FhirW Wing', code: 'FW' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    mrn = `FW${RUN}`;
    const reg = await new PatientService(patientRepo, outbox).register({
      familyName: 'FhirW',
      givenName: 'Pat',
      dateOfBirth: '1994-04-04',
      sex: 'F',
      facilityId: fac.id,
      mrn,
    });
    patientId = reg.patient.id;
    const enc = await encounterRepo.open({ patientId, facilityId: fac.id, type: 'outpatient' });
    encounterId = enc.id;
    partnerId = (
      await partnerRepo.create({
        name: `fhirw-partner-${RUN}`,
        apiKeyHash: hashApiKey(`pulse-int-${RUN}`),
        scopes: ['read', 'write'],
      })
    ).id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates a Condition as origin=external with provenance, access log and outbox event', async () => {
    const out = await svc.importCondition({
      partnerId,
      idempotencyKey: 'int-key-1',
      resource: condition(patientId, encounterId),
    });
    expect(out.created).toBe(true);
    const id = String(out.resource['id']);
    expect(out.resource['meta']).toEqual({ source: 'urn:pulse:origin:external' });

    const row = await db
      .selectFrom('clin.entry')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.origin).toBe('external');
    expect(row.kind).toBe('problem');
    expect(row.status).toBe('active');
    expect(row.patient_id).toBe(patientId);

    const ledger = await db
      .selectFrom('integration.external_resource')
      .selectAll()
      .where('internal_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(ledger).toMatchObject({
      partner_id: partnerId,
      resource_type: 'Condition',
      idempotency_key: 'int-key-1',
      method: 'fhir',
      outcome: 'created',
      source_system: 'external',
    });

    const logs = await db
      .selectFrom('integration.fhir_log')
      .select(['status'])
      .where('resource_type', '=', 'Condition')
      .execute();
    expect(logs.some((l) => l.status === 201)).toBe(true);

    const events = await outboxPeek(db, 'integration.external_imported');
    expect(events).toBeGreaterThanOrEqual(1);
  });

  it('replays the prior Condition for the same key and payload, conflicts on a different payload', async () => {
    const res1 = await svc.importCondition({
      partnerId,
      idempotencyKey: 'int-key-1',
      resource: condition(patientId, encounterId),
    });
    expect(res1.created).toBe(false);
    const firstId = String(
      (
        await db
          .selectFrom('integration.external_resource')
          .select('internal_id')
          .where('partner_id', '=', partnerId)
          .where('idempotency_key', '=', 'int-key-1')
          .executeTakeFirstOrThrow()
      ).internal_id,
    );
    expect(res1.resource['id']).toBe(firstId);

    const dupes = await db
      .selectFrom('integration.external_resource')
      .select(['id'])
      .where('partner_id', '=', partnerId)
      .where('idempotency_key', '=', 'int-key-1')
      .execute();
    expect(dupes).toHaveLength(1);

    expect(
      await statusOf(
        svc.importCondition({
          partnerId,
          idempotencyKey: 'int-key-1',
          resource: { ...condition(patientId, encounterId), code: { text: `Other ${RUN}` } },
        }),
      ),
    ).toBe(409);
  });

  it('rejects unknown patient references with 404 PATIENT_NOT_FOUND', async () => {
    const err = await caught(
      svc.importCondition({ partnerId, resource: condition('77777777-7777-4777-8777-777777777777') }),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toContain('PATIENT_NOT_FOUND');
  });

  it('imports an HL7v2 ORU message as observations with AA ACK and replay', async () => {
    const message = [
      `MSH|^~\\&|LABVENDOR|MAIN|PULSE|HOSP|${RUN}0000||ORU^R01|CTL-${RUN}|P|2.5`,
      `PID|||${mrn}^^^HOSP^MR||FhirW^Pat`,
      'OBX|1|NM|8480-6^Systolic BP^LN||118|mmHg|||F',
      'OBX|2|ST|NOTE^Comment^LN||Feeling well||||||F',
    ].join('\r');
    const out = await svc.importHl7v2Oru({ partnerId, message });
    expect(out.created).toBe(true);
    expect(out.resource['status']).toBe('AA');
    expect(String(out.resource['ack'])).toContain(`MSA|AA|CTL-${RUN}`);
    expect((out.resource['observations'] as unknown[]).length).toBe(2);

    const rows = await db
      .selectFrom('clin.observation')
      .selectAll()
      .where('patient_id', '=', patientId)
      .where('origin', '=', 'external')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.value_num === 118 && r.unit === 'mmHg')).toBe(true);
    expect(rows.some((r) => r.value_text === 'Feeling well')).toBe(true);

    const ledger = await db
      .selectFrom('integration.external_resource')
      .selectAll()
      .where('partner_id', '=', partnerId)
      .where('method', '=', 'hl7v2-oru')
      .execute();
    expect(
      ledger
        .map((l) => String(l.idempotency_key))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([
      `hl7v2-oru:CTL-${RUN}:1`,
      `hl7v2-oru:CTL-${RUN}:2`,
    ]);

    const replay = await svc.importHl7v2Oru({ partnerId, message });
    expect(replay.created).toBe(false);
    expect(replay.resource['replayed']).toBe(true);
    const after = await db
      .selectFrom('clin.observation')
      .select(['id'])
      .where('patient_id', '=', patientId)
      .where('origin', '=', 'external')
      .execute();
    expect(after).toHaveLength(2);
  });

  it('NACKs unknown and ambiguous HL7 patient identifiers (governed resolution)', async () => {
    const message = (identifier: string) =>
      [
        `MSH|^~\\&|LABVENDOR|MAIN|PULSE|HOSP|${RUN}0000||ORU^R01|CTL-AMB-${identifier}|P|2.5`,
        `PID|||${identifier}^^^HOSP^MR||X^Y`,
        'OBX|1|ST|NOTE^C^LN||ok||||||F',
      ].join('\r');
    expect(await statusOf(svc.importHl7v2Oru({ partnerId, message: message(`NOPE${RUN}`) }))).toBe(404);

    // Ambiguity: two distinct patients claim the same identifier value.
    const fac2 = await db
      .selectFrom('org.facility')
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow();
    const patients = new KyselyPatientRepository(db);
    await new PatientService(patients, new OutboxService(db)).register({
      familyName: 'FhirWAmb',
      givenName: 'First',
      dateOfBirth: '1988-08-08',
      sex: 'F',
      facilityId: fac2.id,
      mrn: `AMB${RUN}`,
    });
    const regB = await new PatientService(patients, new OutboxService(db)).register({
      familyName: 'FhirWAmb',
      givenName: 'Second',
      dateOfBirth: '1977-07-07',
      sex: 'F',
      facilityId: fac2.id,
      mrn: `OTHER${RUN}`,
    });
    await db
      .insertInto('patient.identifier')
      .values({ patient_id: regB.patient.id, system: 'urn:pulse:mrn:amb', value: `AMB${RUN}` })
      .execute();
    expect(await statusOf(svc.importHl7v2Oru({ partnerId, message: message(`AMB${RUN}`) }))).toBe(409);
  });

  it('creates Observation with effectiveDateTime and reads provenance back through the FHIR surface', async () => {
    const out = await svc.importObservation({
      partnerId,
      resource: {
        resourceType: 'Observation',
        subject: { reference: `Patient/${patientId}` },
        context: { encounter: { reference: `Encounter/${encounterId}` } },
        code: { text: `PULSE-${RUN}` },
        valueQuantity: { value: 72, unit: 'bpm' },
        effectiveDateTime: '2026-10-05T06:15:00Z',
      },
    });
    expect(out.created).toBe(true);
    const id = String(out.resource['id']);
    const row = await db
      .selectFrom('clin.observation')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.origin).toBe('external');
    expect(row.value_num).toBe(72);
    expect(row.taken_at.toISOString()).toBe('2026-10-05T06:15:00.000Z');

    // Local observation for contrast (no provenance meta).
    await new KyselyClinicalRepository(db).recordObservation({
      patientId,
      code: `LOCAL-${RUN}`,
      valueText: 'local note',
    });

    const bundle = (await fhir.searchObservations(patientId, partnerId)) as {
      entry: { resource: Record<string, unknown> }[];
    };
    const external = bundle.entry.find((e) => e.resource['id'] === id);
    expect(external?.resource['meta']).toEqual({ source: 'urn:pulse:origin:external' });
    const local = bundle.entry.find(
      (e) => (e.resource['code'] as { text?: string } | undefined)?.text === `LOCAL-${RUN}`,
    );
    expect(local?.resource['meta']).toBeUndefined();
  });

  it('rejects an unknown encounter reference with 404', async () => {
    const err = await caught(
      svc.importCondition({
        partnerId,
        resource: condition(patientId, '88888888-8888-4888-8888-888888888888'),
      }),
    );
    expect(err?.status).toBe(404);
    expect(err?.message).toContain('ENCOUNTER_NOT_FOUND');
  });
});

async function outboxPeek(db: Kysely<PulseDatabase>, type: string): Promise<number> {
  const rows = await db
    .selectFrom('integration.outbox')
    .select('id')
    .where('type', '=', type)
    .execute();
  return rows.length;
}
