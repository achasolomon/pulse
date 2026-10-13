import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyMembershipRepository } from './../src/modules/iam/infrastructure/kysely-membership.repository.js';
import { KyselyOrganizationRepository } from './../src/modules/organization/infrastructure/kysely-organization.repository.js';
import { OrganizationService } from './../src/modules/organization/application/organization.service.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('org + membership persistence (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let orgs: OrganizationService;
  let memberships: KyselyMembershipRepository;

  beforeAll(() => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    orgs = new OrganizationService(
      new KyselyOrganizationRepository(db),
      outbox,
    );
    memberships = new KyselyMembershipRepository(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates org + facility, emits outbox facts', async () => {
    const code = `T${Date.now().toString(36).toUpperCase()}`;
    const org = await orgs.createOrganization({
      name: `Test Org ${code}`,
      code,
    });
    expect(org.id).toBeDefined();

    const facility = await orgs.createFacility({
      organizationId: org.id,
      name: 'Main Hospital',
      code: 'MAIN',
    });
    expect(facility.organizationId).toBe(org.id);

    const listed = await orgs.listFacilities(org.id);
    expect(listed.some((f) => f.id === facility.id)).toBe(true);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type', 'aggregate_id'])
      .where('aggregate_id', 'in', [org.id, facility.id])
      .execute();
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('creates + resolves active membership', async () => {
    const code = `M${Date.now().toString(36).toUpperCase()}`;
    const org = await orgs.createOrganization({
      name: `Member Org ${code}`,
      code,
    });
    const facility = await orgs.createFacility({
      organizationId: org.id,
      name: 'Ward Block',
      code: 'WARD',
    });
    const personId = '11111111-1111-1111-1111-111111111111';
    await memberships.create({
      personId,
      organizationId: org.id,
      facilityId: facility.id,
      roles: ['clinician'],
      privileges: ['patient:read'],
    });
    const found = await memberships.findActive(personId, facility.id);
    expect(found?.privileges).toContain('patient:read');
  });
});
