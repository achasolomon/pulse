import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyBloodbankRepository } from './../src/modules/bloodbank/infrastructure/kysely-bloodbank.repository.js';
import { BloodbankService } from './../src/modules/bloodbank/application/bloodbank.service.js';
import { KyselyPatientRepository } from './../src/modules/patient/infrastructure/kysely-patient.repository.js';
import { PatientService } from './../src/modules/patient/application/patient.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('bloodbank chain (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let bank: BloodbankService;
  let facilityId: string;
  let patientId: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    bank = new BloodbankService(new KyselyBloodbankRepository(db), new OutboxService(db));

    const code = `K${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Bank Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: org.id, name: 'Blood Bank', code: 'BB' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    void facilityId;
    const patients = new PatientService(
      new KyselyPatientRepository(db),
      new OutboxService(db),
    );
    patientId = (
      await patients.register({
        familyName: 'Bank', givenName: 'Pat', dateOfBirth: '1992-02-02',
        sex: 'F', facilityId, mrn: `BK${Date.now()}`,
      })
    ).patient.id;
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('collect -> test -> release -> crossmatch -> issue -> transfuse -> complete', async () => {
    const unit = await bank.registerUnit({
      bagId: `BAG-${Date.now()}`, abo: 'O', rh: '-', expiresOn: '2027-01-01',
    });
    await bank.testUnit(unit.id, {});
    await bank.releaseUnit(unit.id, {});
    const xm = await bank.crossmatch({
      patientId, unitId: unit.id, recipientAbo: 'A', recipientRh: '+',
    });
    expect(xm.compatible).toBe(true);
    await bank.issue({ unitId: unit.id, patientId });
    const txn = await bank.startTransfusion({ patientId, unitId: unit.id });
    const done = await bank.finishTransfusion(txn.id, {});
    expect(done.stopped).toBe(false);
  });

  it('incompatible crossmatch is recorded then refused; expired units blocked', async () => {
    const unit = await bank.registerUnit({
      bagId: `BAGX-${Date.now()}`, abo: 'AB', rh: '+', expiresOn: '2027-01-01',
    });
    await bank.testUnit(unit.id, {});
    await bank.releaseUnit(unit.id, {});
    await expect(
      bank.crossmatch({ patientId, unitId: unit.id, recipientAbo: 'O', recipientRh: '-' }),
    ).rejects.toThrow('Incompatible blood group');
    // A second issue attempt without compatibility still fails.
    await expect(bank.issue({ unitId: unit.id, patientId })).rejects.toThrow(
      'compatible crossmatch',
    );

    const old = await bank.registerUnit({
      bagId: `BAGO-${Date.now()}`, abo: 'O', rh: '-', expiresOn: '2020-01-01',
    });
    await bank.testUnit(old.id, {});
    await bank.releaseUnit(old.id, {});
    await expect(
      bank.crossmatch({ patientId, unitId: old.id, recipientAbo: 'O', recipientRh: '-' }),
    ).rejects.toThrow('Expired');
  });

  it('stopped transfusion requires a reaction note', async () => {
    const unit = await bank.registerUnit({
      bagId: `BAGR-${Date.now()}`, abo: 'O', rh: '-', expiresOn: '2027-01-01',
    });
    await bank.testUnit(unit.id, {});
    await bank.releaseUnit(unit.id, {});
    await bank.crossmatch({ patientId, unitId: unit.id, recipientAbo: 'B', recipientRh: '+' });
    await bank.issue({ unitId: unit.id, patientId });
    const txn = await bank.startTransfusion({ patientId, unitId: unit.id });
    await expect(bank.finishTransfusion(txn.id, { reaction: 'severe' })).rejects.toThrow(
      'reaction report',
    );
    const done = await bank.finishTransfusion(txn.id, {
      reaction: 'moderate',
      note: 'Urticaria at 50ml; stopped, antihistamine given',
    });
    expect(done.stopped).toBe(true);
  });
});
