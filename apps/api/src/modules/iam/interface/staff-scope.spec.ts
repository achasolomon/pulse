import { Reflector } from '@nestjs/core';
import { AuthorizationGuard } from './authorization.guard.js';
import { AccessPolicyService } from '../application/access-policy.service.js';
import type { MembershipService } from '../application/membership.service.js';
import type { CredentialRepository } from '../domain/credential.repository.js';

describe('staff membership scope', () => {
  const membership = { membershipId: 'm1', personId: 'p1', organizationId: 'o1', facilityId: 'f1',
    roles: ['nurse'], privileges: ['patient:read'] };
  function guard(found: typeof membership | undefined) {
    return new AuthorizationGuard({ get: () => ({ resourceType: 'patient', action: 'read' }) } as unknown as Reflector,
      new AccessPolicyService(), { findActive: async () => found } as unknown as MembershipService,
      { findSession: async () => ({ personId: 'p1' }) } as unknown as CredentialRepository);
  }
  function context(tenantId = 'o1') {
    return { getHandler: () => ({}), switchToHttp: () => ({ getRequest: () => ({
      headers: { authorization: 'Bearer staff_test', 'x-demo-privileges': 'patient:read' },
      requestContext: { tenantId, facilityId: 'f1' },
    }) }) };
  }
  it('never substitutes demo privileges for a staff actor without membership', async () => {
    await expect(guard(undefined).canActivate(context() as never)).rejects.toMatchObject({ status: 403 });
  });
  it('binds organization and facility before evaluating capabilities', async () => {
    await expect(guard(membership).canActivate(context('other-org') as never)).rejects.toMatchObject({ status: 403 });
    await expect(guard(membership).canActivate(context() as never)).resolves.toBe(true);
  });
});
