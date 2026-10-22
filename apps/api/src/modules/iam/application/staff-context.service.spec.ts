import { StaffContextService } from './staff-context.service.js';
import type { CredentialRepository } from '../domain/credential.repository.js';

const TOKEN = `Bearer staff_${'a'.repeat(64)}`;
describe('staff self context', () => {
  const before = process.env.DATABASE_URL;
  beforeEach(() => { process.env.DATABASE_URL = 'test://configured'; });
  afterEach(() => { if (before === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before; });
  function setup() {
    const credential = { id: 'c1', personId: 'p1', loginId: 'nurse', status: 'active' };
    const findSession = vi.fn(async () => ({ sessionId: 's1', credentialId: 'c1', personId: 'p1',
      scopes: ['staff'], expiresAt: new Date(Date.now() + 60_000) }));
    const findById = vi.fn(async () => credential);
    const listFacilities = vi.fn(async () => [{ membershipId: 'm1', organizationId: 'o1',
      organizationName: 'Hospital group', facilityId: 'f1', facilityName: 'Ward facility', facilityCode: 'F1',
      roles: ['nurse'], privileges: ['patient:read'] }]);
    const service = new StaffContextService({ findSession, findById } as unknown as CredentialRepository, { listFacilities });
    return { service, findSession, findById, listFacilities, credential };
  }
  it('uses backend identity and memberships without requesting a selected facility', async () => {
    const t = setup();
    const context = await t.service.self(TOKEN);
    expect(context).toMatchObject({ personId: 'p1', loginId: 'nurse', sessionId: 's1', facilities: [{ facilityId: 'f1' }] });
    expect(t.listFacilities).toHaveBeenCalledWith('p1');
    expect(context).not.toHaveProperty('token');
  });
  it('rejects absent, demo, malformed or revoked sessions before disclosing memberships', async () => {
    const t = setup();
    for (const token of [undefined, 'Bearer demo', 'Bearer staff_bad']) await expect(t.service.self(token)).rejects.toMatchObject({ status: 401 });
    expect(t.findSession).not.toHaveBeenCalled();
    t.findSession.mockResolvedValueOnce(undefined as never);
    await expect(t.service.self(TOKEN)).rejects.toMatchObject({ status: 401 });
    expect(t.listFacilities).not.toHaveBeenCalled();
  });
  it('rejects expired, disabled and mismatched identity and never trusts cookie names', async () => {
    const t = setup();
    t.findSession.mockResolvedValueOnce({ sessionId: 's1', credentialId: 'c1', personId: 'p1', scopes: [], expiresAt: new Date(0) });
    await expect(t.service.self(TOKEN)).rejects.toMatchObject({ status: 401 });
    t.credential.status = 'disabled';
    await expect(t.service.self(TOKEN)).rejects.toMatchObject({ status: 401 });
    t.credential.status = 'active'; t.credential.personId = 'p2';
    await expect(t.service.self(TOKEN)).rejects.toMatchObject({ status: 401 });
    expect(t.listFacilities).not.toHaveBeenCalled();
  });
  it('reports missing database as unavailable and permits an authenticated empty membership list', async () => {
    const t = setup(); delete process.env.DATABASE_URL;
    await expect(t.service.self(TOKEN)).rejects.toMatchObject({ status: 503 });
    process.env.DATABASE_URL = 'test://configured'; t.listFacilities.mockResolvedValueOnce([]);
    await expect(t.service.self(TOKEN)).resolves.toMatchObject({ facilities: [] });
  });
});
