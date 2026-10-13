import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyBreakGlassRepository } from './../src/modules/iam/infrastructure/kysely-break-glass.repository.js';
import { KyselyCareAssignmentRepository } from './../src/modules/iam/infrastructure/kysely-care-assignment.repository.js';
import { KyselyMembershipRepository } from './../src/modules/iam/infrastructure/kysely-membership.repository.js';
import { BreakGlassService } from './../src/modules/iam/application/break-glass.service.js';
import { MembershipService } from './../src/modules/iam/application/membership.service.js';
import { evaluateAccess } from './../src/modules/iam/domain/policy.js';
import { BREAK_GLASS_TTL_MS } from './../src/modules/iam/domain/break-glass.js';
import { OutboxService } from './../src/platform/outbox/outbox.service.js';
import type { PulseDatabase } from './../src/platform/database/db.types.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('contextual authorization + break-glass (integration)', () => {
  let db: Kysely<PulseDatabase>;
  let breakGlass: BreakGlassService;
  let careAssignments: KyselyCareAssignmentRepository;
  let orgId: string;
  let facilityId: string;
  let otherFacilityId: string;
  let patientId: string;

  const PERSON = '33333333-3333-4333-8333-333333333333';
  const BG_PERSON = '44444444-4444-4444-8444-444444444444';
  const REASON = 'cardiac arrest in ED, on-call unreachable';

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = new Kysely<PulseDatabase>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxService(db);
    breakGlass = new BreakGlassService(new KyselyBreakGlassRepository(db), outbox);
    careAssignments = new KyselyCareAssignmentRepository(db);

    // Idempotent re-runs: drop this suite's prior grants/memberships so the
    // 24h abuse window and department scope always start from a clean slate.
    await db
      .deleteFrom('iam.break_glass_grant')
      .where('person_id', 'in', [BG_PERSON, '66666666-6666-4666-8666-666666666666'])
      .execute();
    await db
      .deleteFrom('iam.membership')
      .where('person_id', 'in', [PERSON, BG_PERSON, '55555555-5555-4555-8555-555555555555'])
      .execute();

    const code = `CA${Date.now().toString(36).toUpperCase()}`;
    const org = await db
      .insertInto('org.organization')
      .values({ name: `Ctx Org ${code}`, code: code.slice(0, 12) })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    orgId = org.id;
    const fac = await db
      .insertInto('org.facility')
      .values({ organization_id: orgId, name: 'Ctx Main', code: 'CM' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    facilityId = fac.id;
    const fac2 = await db
      .insertInto('org.facility')
      .values({ organization_id: orgId, name: 'Ctx Other', code: 'CO' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    otherFacilityId = fac2.id;
    const pat = await db
      .insertInto('patient.patient')
      .values({
        family_name: 'Ctx',
        given_name: 'Patient',
        date_of_birth: '1990-01-01',
        sex: 'U',
        facility_id: facilityId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    patientId = pat.id;
    await db
      .insertInto('iam.membership')
      .values({
        person_id: PERSON,
        organization_id: orgId,
        facility_id: facilityId,
        roles: ['physician'],
        privileges: ['patient:read'],
      })
      .execute();
    await db
      .insertInto('iam.membership')
      .values({
        person_id: BG_PERSON,
        organization_id: orgId,
        facility_id: facilityId,
        roles: ['nurse'],
        privileges: [],
      })
      .execute();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('care assignment narrows chart access: none denies, assignment allows, lapse re-denies', async () => {
    const base = {
      personId: PERSON,
      facilityId,
      action: 'read',
      resourceType: 'patient',
      patientId,
    } as const;

    const noRel = evaluateAccess({
      ...base,
      membership: {
        membershipId: 'm1',
        personId: PERSON,
        organizationId: orgId,
        facilityId,
        roles: ['physician'],
        privileges: ['patient:read'],
      },
      careRelationship: false,
    });
    expect(noRel).toEqual({ allow: false, reason: 'DENY_NO_CARE_RELATIONSHIP' });

    const assignment = await careAssignments.create({
      patientId,
      personId: PERSON,
      facilityId,
      kind: 'primary',
    });
    const found = await careAssignments.findActive({
      patientId,
      personId: PERSON,
      facilityId,
    });
    expect(found?.id).toBe(assignment.id);

    const withRel = evaluateAccess({
      ...base,
      membership: {
        membershipId: 'm1',
        personId: PERSON,
        organizationId: orgId,
        facilityId,
        roles: ['physician'],
        privileges: ['patient:read'],
      },
      careRelationship: true,
    });
    expect(withRel).toEqual({
      allow: true,
      reason: 'ALLOW_MEMBERSHIP_PRIVILEGE',
    });

    await db
      .updateTable('iam.care_assignment')
      .set({ effective_to: new Date(Date.now() - 60_000) })
      .where('id', '=', assignment.id)
      .execute();
    const lapsed = await careAssignments.findActive({
      patientId,
      personId: PERSON,
      facilityId,
    });
    expect(lapsed).toBeUndefined();
  });

  it('department scope on membership narrows access (mismatch denies, match allows)', async () => {
    const dept = await db
      .insertInto('org.department')
      .values({ facility_id: facilityId, name: 'Cardiology', code: 'CARD' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const dept2 = await db
      .insertInto('org.department')
      .values({ facility_id: facilityId, name: 'Neurology', code: 'NEUR' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const person = '55555555-5555-4555-8555-555555555555';
    await db
      .insertInto('iam.membership')
      .values({
        person_id: person,
        organization_id: orgId,
        facility_id: facilityId,
        roles: ['nurse'],
        privileges: ['patient:read'],
        department_id: dept.id,
      })
      .execute();

    const memberships = new MembershipService(new KyselyMembershipRepository(db));
    const membership = await memberships.findActive(person, facilityId);
    expect(membership?.departmentId).toBe(dept.id);

    const mismatch = evaluateAccess({
      personId: person,
      membership: { ...membership, facilityId } as never,
      facilityId,
      departmentId: dept2.id,
      action: 'read',
      resourceType: 'patient',
    });
    expect(mismatch).toEqual({ allow: false, reason: 'DENY_DEPARTMENT_MISMATCH' });

    const match = evaluateAccess({
      personId: person,
      membership: { ...membership, facilityId } as never,
      facilityId,
      departmentId: dept.id,
      action: 'read',
      resourceType: 'patient',
    });
    expect(match).toEqual({ allow: true, reason: 'ALLOW_MEMBERSHIP_PRIVILEGE' });

    const facilityMismatch = evaluateAccess({
      personId: person,
      membership: { ...membership, facilityId } as never,
      facilityId: otherFacilityId,
      action: 'read',
      resourceType: 'patient',
    });
    expect(facilityMismatch).toEqual({
      allow: false,
      reason: 'DENY_FACILITY_MISMATCH',
    });
  });

  it('break-glass grant: reasoned, 30-minute, counted, and audited via outbox', async () => {
    const grant = await breakGlass.activate({
      personId: BG_PERSON,
      facilityId,
      patientId,
      resourceType: 'patient',
      action: 'read',
      reason: REASON,
    });
    expect(grant.grantId).toBeDefined();
    const ttl = grant.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(BREAK_GLASS_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(BREAK_GLASS_TTL_MS + 60_000);

    const recent = await breakGlass.countRecent(BG_PERSON);
    expect(recent).toBe(1);

    const active = await new KyselyBreakGlassRepository(db).findActive({
      personId: BG_PERSON,
      facilityId,
      patientId,
      now: new Date(),
    });
    expect(active?.id).toBe(grant.grantId);

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_type', '=', 'break_glass_grant')
      .where('aggregate_id', '=', grant.grantId)
      .execute();
    expect(events.map((e) => e.type)).toContain('BreakGlassActivated');
  });

  it('break-glass abuse: denied once 24h grants reach the threshold', async () => {
    await breakGlass.activate({
      personId: BG_PERSON,
      facilityId,
      resourceType: 'patient',
      action: 'read',
      reason: REASON,
    });
    await breakGlass.activate({
      personId: BG_PERSON,
      facilityId,
      resourceType: 'encounter',
      action: 'read',
      reason: REASON,
    });
    expect(await breakGlass.countRecent(BG_PERSON)).toBe(3);
    await expect(
      breakGlass.activate({
        personId: BG_PERSON,
        facilityId,
        resourceType: 'lab.result',
        action: 'read',
        reason: REASON,
      }),
    ).rejects.toThrow('Break-glass denied');
  });

  it('break-glass never covers financial, destructive, or throwaway use', async () => {
    await expect(
      breakGlass.activate({
        personId: BG_PERSON,
        facilityId,
        resourceType: 'charge',
        action: 'capture',
        reason: REASON,
      }),
    ).rejects.toThrow('Break-glass covers clinical patient data only');
    await expect(
      breakGlass.activate({
        personId: BG_PERSON,
        facilityId,
        resourceType: 'patient',
        action: 'delete',
        reason: REASON,
      }),
    ).rejects.toThrow('Break-glass covers clinical patient data only');
    await expect(
      breakGlass.activate({
        personId: BG_PERSON,
        facilityId,
        resourceType: 'patient',
        action: 'read',
        reason: 'urgent',
      }),
    ).rejects.toThrow('Break-glass requires a specific emergency justification');
  });

  it('sweepExpired marks lapsed grants revoked and emits BreakGlassExpired', async () => {
    const repo = new KyselyBreakGlassRepository(db);
    const lapsed = await repo.create({
      personId: '66666666-6666-4666-8666-666666666666',
      facilityId,
      resourceType: 'patient',
      action: 'read',
      reason: REASON,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const swept = await breakGlass.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);

    const gone = await repo.findActive({
      personId: '66666666-6666-4666-8666-666666666666',
      facilityId,
      now: new Date(),
    });
    expect(gone).toBeUndefined();

    const events = await db
      .selectFrom('integration.outbox')
      .select(['type'])
      .where('aggregate_type', '=', 'break_glass_grant')
      .where('aggregate_id', '=', lapsed.id)
      .execute();
    expect(events.map((e) => e.type)).toContain('BreakGlassExpired');
  });
});
