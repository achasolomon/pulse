import { ExternalImportService } from './external-import.service.js';
import { fingerprint } from '../domain/from-fhir.js';
import type { ExternalResourceRepository, LedgerRecord } from '../infrastructure/external-resource.repository.js';
import type { ClinicalRepository, ClinicalEntry, Observation } from '../../clinical/domain/clinical.repository.js';
import type { PatientRepository } from '../../patient/domain/patient.repository.js';
import type { EncounterRepository, Encounter } from '../../encounter/domain/encounter.repository.js';
import type { PartnerRepository } from '../infrastructure/partner.repository.js';
import type { OutboxService } from '../../../platform/outbox/outbox.service.js';

const PID = '11111111-1111-4111-8111-111111111111';
const PID2 = '11111111-1111-4111-8111-111111112222';
const PID_UNKNOWN = '11111111-1111-4111-8111-111111119999';
const EID = '22222222-2222-4222-8222-222222222222';
const E_OTHER = '22222222-2222-4222-8222-222222223333';
const PARTNER = '99999999-9999-4999-8999-999999999999';

function uniqueError(): Error & { code: string } {
  const e = new Error('duplicate key value violates unique constraint') as Error & { code: string };
  e.code = '23505';
  return e;
}

function fakeLedger() {
  const rows = new Map<string, { internalId: string; requestFingerprint: string }>();
  const nullKeys: { internalId: string; requestFingerprint: string }[] = [];
  let raceWinner: { internalId: string; requestFingerprint: string } | undefined;
  let hidden = false;
  const key = (p: string, rt: string, k: string) => `${p}|${rt}|${k}`;
  return {
    rows,
    /** Simulate a concurrent winner: first read misses, insert loses the race. */
    armRace(winner: { internalId: string; requestFingerprint: string }) {
      raceWinner = winner;
      hidden = true;
    },
    repo: {
      async findByIdempotencyKey(p: string, rt: string, k: string) {
        if (hidden) {
          hidden = false;
          return undefined;
        }
        if (raceWinner) return raceWinner;
        return rows.get(key(p, rt, k));
      },
      async insert(rec: LedgerRecord) {
        if (raceWinner) throw uniqueError();
        if (rec.idempotencyKey === null) {
          nullKeys.push({ internalId: rec.internalId, requestFingerprint: rec.requestFingerprint });
          return;
        }
        const k = key(rec.partnerId, rec.resourceType, rec.idempotencyKey);
        if (rows.has(k)) throw uniqueError();
        rows.set(k, { internalId: rec.internalId, requestFingerprint: rec.requestFingerprint });
      },
      async deleteByKey(p: string, rt: string, k: string) {
        rows.delete(key(p, rt, k));
      },
    } satisfies ExternalResourceRepository,
  };
}

function fakeClinical() {
  const entries: (ClinicalEntry & { id?: string })[] = [];
  const observations: (Observation & { id?: string })[] = [];
  let failNext = false;
  let seq = 0;
  return {
    entries,
    observations,
    failNextCreate() {
      failNext = true;
    },
    repo: {
      async recordEntry(input: ClinicalEntry) {
        if (failNext) {
          failNext = false;
          throw new Error('domain insert failed');
        }
        entries.push(input);
        return { id: input.id ?? `gen-${++seq}` };
      },
      async recordObservation(input: Observation) {
        if (failNext) {
          failNext = false;
          throw new Error('domain insert failed');
        }
        observations.push(input);
        return { id: input.id ?? `gen-${++seq}` };
      },
    } as unknown as ClinicalRepository,
  };
}

function setup(opts: { identifierPatients?: string[] } = {}) {
  const ledger = fakeLedger();
  const clinical = fakeClinical();
  const log: { resourceType: string; status: number }[] = [];
  const published: string[] = [];
  const patients = {
    async findById(id: string) {
      if (id === PID || id === PID2) return { id };
      return undefined;
    },
    async findByIdentifierValue(value: string) {
      if (value === 'MRN-42') return (opts.identifierPatients ?? [PID]).map((id) => ({ id }));
      if (value === 'MRN-AMB') return [{ id: PID }, { id: PID2 }];
      return [];
    },
  } as unknown as PatientRepository;
  const encounters = {
    async findById(id: string): Promise<Encounter | undefined> {
      if (id === EID) return { id, patientId: PID, facilityId: 'f', type: 'outpatient', status: 'open' };
      if (id === E_OTHER) return { id, patientId: PID2, facilityId: 'f', type: 'outpatient', status: 'open' };
      return undefined;
    },
  } as unknown as EncounterRepository;
  const partners = {
    async logAccess(input: { resourceType: string; status: number }) {
      log.push(input);
      return Promise.resolve();
    },
  } as unknown as PartnerRepository;
  const outbox = {
    async publish(input: { type: string }) {
      published.push(input.type);
      return { eventId: 'e', type: input.type, occurredAt: '' };
    },
  } as unknown as OutboxService;
  const svc = new ExternalImportService(
    ledger.repo,
    patients,
    encounters,
    clinical.repo,
    partners,
    outbox,
  );
  return { svc, ledger, clinical, log, published };
}

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

const condition = {
  resourceType: 'Condition',
  subject: { reference: `Patient/${PID}` },
  context: { encounter: { reference: `Encounter/${EID}` } },
  code: { coding: [{ code: '111810001' }], text: 'Asthma' },
};

describe('ExternalImportService (unit, fakes)', () => {
  it('creates a Condition with origin=external, provenance and outbox event', async () => {
    const { svc, ledger, clinical, log, published } = setup();
    const out = await svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition });
    expect(out.created).toBe(true);
    const id = String(out.resource['id']);
    expect(out.resource['resourceType']).toBe('Condition');
    expect(clinical.entries).toHaveLength(1);
    expect(clinical.entries[0]).toMatchObject({
      id,
      kind: 'problem',
      status: 'active',
      origin: 'external',
      patientId: PID,
      encounterId: EID,
    });
    expect(ledger.rows.size).toBe(1);
    expect(log).toContainEqual(expect.objectContaining({ status: 201 }));
    expect(published).toEqual(['integration.external_imported']);
  });

  it('replays the prior outcome for same key + same payload (no duplicate row)', async () => {
    const { svc, clinical, log } = setup();
    const first = await svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition });
    const second = await svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition });
    expect(second.created).toBe(false);
    expect(second.resource['id']).toBe(first.resource['id']);
    expect(clinical.entries).toHaveLength(1);
    expect(log).toContainEqual(expect.objectContaining({ status: 200 }));
  });

  it('conflicts when the same key arrives with a different payload', async () => {
    const { svc } = setup();
    await svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition });
    const err = await caught(
      svc.importCondition({
        partnerId: PARTNER,
        idempotencyKey: 'k1',
        resource: { ...condition, code: { text: 'Different' } },
      }),
    );
    expect(err?.status).toBe(409);
    expect(err?.message).toContain('IDEMPOTENCY_CONFLICT');
  });

  it('recovers from a lost insert race by replaying the winner', async () => {
    const { svc, ledger, clinical } = setup();
    const winnerId = '44444444-4444-4444-8444-444444444444';
    ledger.armRace({ internalId: winnerId, requestFingerprint: fingerprint(condition) });
    const out = await svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition });
    expect(out.created).toBe(false);
    expect(out.resource['id']).toBe(winnerId);
    expect(clinical.entries).toHaveLength(0);
  });

  it('creates without an idempotency key (provenance still recorded)', async () => {
    const { svc, ledger, clinical } = setup();
    const out = await svc.importCondition({ partnerId: PARTNER, resource: condition });
    expect(out.created).toBe(true);
    expect(ledger.rows.size).toBe(0);
    expect(clinical.entries).toHaveLength(1);
  });

  it('fails validation/identity errors with OperationOutcome codes', async () => {
    const { svc, clinical } = setup();
    expect(await statusOf(svc.importCondition({ partnerId: PARTNER, resource: { resourceType: 'Condition' } }))).toBe(400);
    expect(await statusOf(svc.importCondition({ partnerId: PARTNER, resource: { ...condition, subject: { reference: `Patient/${PID_UNKNOWN}` } } }))).toBe(404);
    expect(await statusOf(svc.importCondition({ partnerId: undefined, resource: condition }))).toBe(401);
    expect(await statusOf(svc.importCondition({ partnerId: PARTNER, resource: { ...condition, context: { encounter: { reference: `Encounter/${E_OTHER}` } } } }))).toBe(400);
    expect(await statusOf(svc.importCondition({ partnerId: PARTNER, resource: { ...condition, context: { encounter: { reference: 'Encounter/33333333-3333-4333-8333-333333339999' } } } }))).toBe(404);
    expect(clinical.entries).toHaveLength(0);
  });

  it('compensates the claim when the domain insert fails', async () => {
    const { svc, ledger, clinical } = setup();
    clinical.failNextCreate();
    await expect(
      svc.importCondition({ partnerId: PARTNER, idempotencyKey: 'k1', resource: condition }),
    ).rejects.toThrow('domain insert failed');
    expect(ledger.rows.size).toBe(0);
  });

  it('imports an HL7v2 ORU message as per-OBX observations with AA ACK', async () => {
    const { svc, ledger, clinical } = setup();
    const msg = [
      'MSH|^~\\&|LAB|MAIN|PULSE|HOSP|20261001083000||ORU^R01|CTL-9|P|2.5',
      'PID|||MRN-42^^^HOSP^MR||Doe^Jane',
      'OBX|1|NM|8480-6^Systolic^LN||120|mmHg|||F',
      'OBX|2|ST|NOTE^Comment^LN||All clear||||||F',
    ].join('\r');
    const out = await svc.importHl7v2Oru({ partnerId: PARTNER, message: msg });
    expect(out.created).toBe(true);
    expect(out.resource['status']).toBe('AA');
    expect(String(out.resource['ack'])).toContain('MSA|AA|CTL-9');
    expect(clinical.observations).toHaveLength(2);
    expect(clinical.observations[0]).toMatchObject({ valueNum: 120, unit: 'mmHg', origin: 'external' });
    expect(clinical.observations[1]).toMatchObject({ valueText: 'All clear', origin: 'external' });
    expect([...ledger.rows.keys()]).toEqual(
      expect.arrayContaining([
        `${PARTNER}|Observation|hl7v2-oru:CTL-9:1`,
        `${PARTNER}|Observation|hl7v2-oru:CTL-9:2`,
      ]),
    );

    const replay = await svc.importHl7v2Oru({ partnerId: PARTNER, message: msg });
    expect(replay.created).toBe(false);
    expect(replay.resource['replayed']).toBe(true);
    expect(clinical.observations).toHaveLength(2);
  });

  it('NACKs unknown or ambiguous HL7 patient identifiers (never guesses)', async () => {
    const { svc } = setup();
    const msg = (mrn: string) =>
      ['MSH|^~\\&|LAB|MAIN|PULSE|HOSP|20261001083000||ORU^R01|CTL-1|P|2.5', `PID|||${mrn}`, 'OBX|1|ST|NOTE^C^LN||ok||||||F'].join('\r');
    expect(await statusOf(svc.importHl7v2Oru({ partnerId: PARTNER, message: msg('MRN-NOPE') }))).toBe(404);
    expect(await statusOf(svc.importHl7v2Oru({ partnerId: PARTNER, message: msg('MRN-AMB') }))).toBe(409);
  });

  it('creates Observation with explicit effectiveDateTime', async () => {
    const { svc, clinical } = setup();
    const out = await svc.importObservation({
      partnerId: PARTNER,
      resource: {
        resourceType: 'Observation',
        subject: { reference: `Patient/${PID}` },
        code: { text: 'HR' },
        valueQuantity: { value: 72, unit: 'bpm' },
        effectiveDateTime: '2026-10-02T07:00:00Z',
      },
    });
    expect(out.created).toBe(true);
    expect(clinical.observations[0]).toMatchObject({
      valueNum: 72,
      unit: 'bpm',
      takenAt: '2026-10-02T07:00:00.000Z',
      origin: 'external',
    });
  });
});
