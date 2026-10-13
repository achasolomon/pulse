import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyBedflowRepository } from './../src/modules/bedflow/infrastructure/kysely-bedflow.repository.js';
import { BedflowService } from './../src/modules/bedflow/application/bedflow.service.js';
import type { EncounterRepository } from './../src/modules/encounter/domain/encounter.repository.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  try {
    await p;
    throw new Error(`expected rejection ${code}`);
  } catch (err) {
    const e = err as { getResponse: () => unknown; getStatus: () => number };
    expect((e.getResponse() as { code?: string }).code).toBe(code);
    if (status !== undefined) expect(e.getStatus()).toBe(status);
  }
}

describe.skipIf(!hasDb)('ICU/HDU bed-flow (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let bedflow: BedflowService;
  let facilityId: string;
  let otherFacilityId: string;
  let wardBed: string;
  let wardBed2: string;
  let icuBed1: string;
  let icuBed2: string;
  let otherFacBed: string;
  let encA: string;
  let encB: string;
  let encDead: string;
  const RUN = `B${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    bedflow = new BedflowService(
      new KyselyBedflowRepository(db),
      {
        findById: async (id: string) => {
          const r = await db
            .selectFrom('encounter.encounter')
            .select(['id', 'patient_id', 'facility_id', 'type', 'status'])
            .where('id', '=', id)
            .executeTakeFirst();
          return r
            ? {
                id: r.id,
                patientId: r.patient_id,
                facilityId: r.facility_id,
                type: r.type as 'inpatient',
                status: r.status as 'admitted',
              }
            : undefined;
        },
      } as unknown as EncounterRepository,
      new OutboxService(db),
    );

    const org = await db
      .insertInto('org.organization')
      .values({ name: `Flow Org ${RUN}`, code: RUN.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Main', code: `M${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const fac2 = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Annex', code: `A${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    otherFacilityId = fac2.id;

    const unit = await db
      .insertInto('org.unit')
      .values({ facility_id: facilityId, name: `ICU ${RUN}`, code: `U${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const unit2 = await db
      .insertInto('org.unit')
      .values({ facility_id: otherFacilityId, name: 'Annex Ward', code: `V${RUN}`.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const mkBed = async (unitRow: string, facRow: string, code: string, name: string) => {
      const r = await db
        .insertInto('org.location')
        .values({ unit_id: unitRow, facility_id: facRow, name, code: `${code}${RUN}`.slice(0, 12), kind: 'bed' })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return r.id;
    };
    wardBed = await mkBed(unit.id, facilityId, 'W', 'Ward bed');
    wardBed2 = await mkBed(unit.id, facilityId, 'W2', 'Ward bed 2');
    icuBed1 = await mkBed(unit.id, facilityId, 'I', 'ICU bed isolation');
    icuBed2 = await mkBed(unit.id, facilityId, 'I2', 'ICU bed 2');
    otherFacBed = await mkBed(unit2.id, otherFacilityId, 'O', 'Annex bed');

    const patient = await db
      .insertInto('patient.patient')
      .values({
        facility_id: facilityId,
        family_name: `Flow${RUN}`,
        given_name: 'Pat',
        date_of_birth: '1975-05-05',
        sex: 'M',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const mkEnc = async (status: string) => {
      const r = await db
        .insertInto('encounter.encounter')
        .values({ patient_id: patient.id, facility_id: facilityId, type: 'inpatient', status })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return r.id;
    };
    encA = await mkEnc('admitted');
    encB = await mkEnc('admitted');
    encDead = await mkEnc('discharged');
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('ICU escalation: level gate, assign, transfer, release, de-escalate; outbox + DB unique backstop', async () => {
    await bedflow.configureBed(wardBed, { levelOfCare: 'ward' });
    await bedflow.configureBed(wardBed2, { levelOfCare: 'ward' });
    await bedflow.configureBed(icuBed1, { levelOfCare: 'icu', isolationCapable: true });
    await bedflow.configureBed(icuBed2, { levelOfCare: 'icu' });
    await bedflow.configureBed(otherFacBed, { levelOfCare: 'ward' });

    await expectCode(
      bedflow.assignBed({ encounterId: encA, locationId: icuBed1 }),
      'LEVEL_OF_CARE_REQUIRED',
      422,
    );

    const level = await bedflow.setLevelOfCare({
      encounterId: encA,
      level: 'icu',
      reason: `Post-op respiratory failure ${RUN}`,
    });
    expect(level.level).toBe('icu');

    await expectCode(
      bedflow.assignBed({ encounterId: encB, locationId: otherFacBed }),
      'FACILITY_MISMATCH',
      422,
    );

    const available = await bedflow.listAvailableBeds(facilityId, { level: 'icu' });
    expect(available.map((b) => b.id).sort()).toEqual([icuBed1, icuBed2].sort());
    const isolation = await bedflow.listAvailableBeds(facilityId, { isolation: true });
    expect(isolation.map((b) => b.id)).toEqual([icuBed1]);

    const a1 = await bedflow.assignBed({ encounterId: encA, locationId: icuBed1 });
    expect(a1.status).toBe('active');
    await expectCode(
      bedflow.assignBed({ encounterId: encA, locationId: icuBed2 }),
      'ENCOUNTER_ALREADY_IN_BED',
      409,
    );
    await expectCode(
      bedflow.assignBed({ encounterId: encB, locationId: icuBed1 }),
      'BED_UNAVAILABLE',
      409,
    );

    const moved = await bedflow.transferBed({ encounterId: encA, locationId: icuBed2 });
    expect(moved.locationId).toBe(icuBed2);
    const old = await db
      .selectFrom('flow.bed_assignment')
      .select(['status'])
      .where('id', '=', a1.id)
      .executeTakeFirstOrThrow();
    expect(old.status).toBe('ended');

    const released = await bedflow.releaseBed({ encounterId: encA });
    expect(released.status).toBe('ended');
    await expectCode(bedflow.releaseBed({ encounterId: encA }), 'NO_ACTIVE_ASSIGNMENT', 409);

    await bedflow.setLevelOfCare({
      encounterId: encA,
      level: 'ward',
      reason: `Stepped down after improvement ${RUN}`,
    });
    const lvl = await bedflow.getLevelOfCare(encA);
    expect(lvl.current?.level).toBe('ward');
    expect(lvl.history.filter((h) => h.status === 'ended')).toHaveLength(1);

    await bedflow.assignBed({ encounterId: encB, locationId: wardBed });
    await expectCode(
      bedflow.setOutOfService(wardBed, { reason: `Cleaning ${RUN}` }),
      'BED_OCCUPIED',
      409,
    );
    const oos = await bedflow.setOutOfService(wardBed2, { reason: `Maintenance ${RUN}` });
    expect(oos.outOfService).toBe(true);
    await expectCode(
      bedflow.assignBed({ encounterId: encA, locationId: wardBed2 }),
      'BED_UNAVAILABLE',
      409,
    );
    const back = await bedflow.returnToService(wardBed2);
    expect(back.outOfService).toBe(false);
    await expectCode(
      bedflow.assignBed({ encounterId: encDead, locationId: wardBed2 }),
      'ENCOUNTER_NOT_ACTIVE',
      409,
    );

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('type', 'like', 'flow.%')
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'flow.bed_configured',
        'flow.level_of_care_set',
        'flow.bed_assigned',
        'flow.bed_transferred',
        'flow.bed_released',
        'flow.bed_out_of_service',
        'flow.bed_in_service',
      ]),
    );

    // DB partial-unique backstop: a second active assignment for the same bed
    // is impossible even for direct SQL (one-active-per-bed index).
    await bedflow.setLevelOfCare({
      encounterId: encA,
      level: 'icu',
      reason: `Re-escalation for occupancy backstop ${RUN}`,
    });
    await bedflow.assignBed({ encounterId: encA, locationId: icuBed1 });
    let dbError = false;
    try {
      await db
        .insertInto('flow.bed_assignment')
        .values({ location_id: icuBed1, encounter_id: encB, facility_id: facilityId })
        .execute();
    } catch {
      dbError = true;
    }
    expect(dbError).toBe(true);
    await bedflow.releaseBed({ encounterId: encA });
  });
});
