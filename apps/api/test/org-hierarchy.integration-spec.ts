import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyOrganizationRepository } from './../src/modules/organization/infrastructure/kysely-organization.repository.js';
import { OrganizationService } from './../src/modules/organization/application/organization.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('org hierarchy (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let orgs: OrganizationService;

  beforeAll(() => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    orgs = new OrganizationService(new KyselyOrganizationRepository(db), outbox);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('builds facility -> department -> unit -> location and emits outbox facts', async () => {
    const code = `H${Date.now().toString(36).toUpperCase()}`;
    const org = await orgs.createOrganization({ name: `Hierarchy Org ${code}`, code });
    const facility = await orgs.createFacility({
      organizationId: org.id,
      name: 'Hierarchy Main',
      code: 'HMAIN',
    });

    const parent = await orgs.createDepartment({
      facilityId: facility.id,
      name: 'Medicine',
      code: 'MED',
    });
    const child = await orgs.createDepartment({
      facilityId: facility.id,
      name: 'Cardiology',
      code: 'CARD',
      parentDepartmentId: parent.id,
    });
    expect(child.parentDepartmentId).toBe(parent.id);

    const listed = await orgs.listDepartments(facility.id);
    expect(listed.some((d) => d.id === parent.id)).toBe(true);
    expect(listed.some((d) => d.id === child.id)).toBe(true);

    const unit = await orgs.createUnit({
      facilityId: facility.id,
      name: 'Ward A',
      code: 'WA',
    });
    expect(unit.facilityId).toBe(facility.id);

    const location = await orgs.createLocation({
      unitId: unit.id,
      facilityId: facility.id,
      name: 'Bed 1',
      code: 'B1',
      kind: 'bed',
    });
    expect(location.unitId).toBe(unit.id);
    expect(location.kind).toBe('bed');

    const unitLocations = await orgs.listLocations(unit.id);
    expect(unitLocations.some((l) => l.id === location.id)).toBe(true);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type', 'aggregate_id'])
      .where('aggregate_id', 'in', [parent.id, child.id, unit.id, location.id])
      .execute();
    const types = events.map((e) => e.type);
    expect(types).toContain('department.created');
    expect(types).toContain('unit.created');
    expect(types).toContain('location.created');
  });

  it('rejects a parent department from another facility', async () => {
    const code = `X${Date.now().toString(36).toUpperCase()}`;
    const org = await orgs.createOrganization({ name: `XFac Org ${code}`, code });
    const facilityA = await orgs.createFacility({
      organizationId: org.id,
      name: 'Facility A',
      code: 'FA',
    });
    const facilityB = await orgs.createFacility({
      organizationId: org.id,
      name: 'Facility B',
      code: 'FB',
    });
    const parentA = await orgs.createDepartment({
      facilityId: facilityA.id,
      name: 'Dept A',
      code: 'DA',
    });
    await expect(
      orgs.createDepartment({
        facilityId: facilityB.id,
        name: 'Dept B',
        code: 'DB',
        parentDepartmentId: parentA.id,
      }),
    ).rejects.toThrow('Parent department must belong to the same facility');
  });

  it('rejects a unit from another facility when creating a location', async () => {
    const code = `Y${Date.now().toString(36).toUpperCase()}`;
    const org = await orgs.createOrganization({ name: `YFac Org ${code}`, code });
    const facilityA = await orgs.createFacility({
      organizationId: org.id,
      name: 'Facility A',
      code: 'YA',
    });
    const facilityB = await orgs.createFacility({
      organizationId: org.id,
      name: 'Facility B',
      code: 'YB',
    });
    const unitA = await orgs.createUnit({
      facilityId: facilityA.id,
      name: 'Unit A',
      code: 'UA',
    });
    await expect(
      orgs.createLocation({
        unitId: unitA.id,
        facilityId: facilityB.id,
        name: 'Loc B',
        code: 'LB',
        kind: 'bed',
      }),
    ).rejects.toThrow('Unit must belong to the same facility');
  });
});
