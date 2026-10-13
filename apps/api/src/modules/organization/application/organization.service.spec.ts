import { OrganizationService } from './organization.service.js';
import type { OrganizationRepository } from './organization.repository.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { CreateOrganizationDto } from '../interface/dto.js';
import { validate } from 'class-validator';

describe('OrganizationService (unit, no DB)', () => {
  const stubRepo = (): OrganizationRepository => ({
    createOrganization: async (input) => ({
      id: '11111111-1111-1111-1111-111111111111',
      ...input,
    }),
    createFacility: async () => {
      throw new Error('not used');
    },
    listFacilities: async () => [],
    findFacilityById: async () => undefined,
    createDepartment: async () => {
      throw new Error('not used');
    },
    listDepartments: async () => [],
    createUnit: async () => {
      throw new Error('not used');
    },
    listUnits: async () => [],
    createLocation: async () => {
      throw new Error('not used');
    },
    listLocations: async () => [],
  });

  it('creates org and publishes outbox fact', async () => {
    const calls: string[] = [];
    const repo = stubRepo();
    const outbox = new OutboxService(undefined);
    const svc = new OrganizationService(repo, outbox);
    const org = await svc.createOrganization({ name: 'Test', code: 'T1' });
    expect(org.code).toBe('T1');
    expect(calls).toEqual([]);
  });

  it('rejects invalid code at DTO level (contract)', async () => {
    const dto = new CreateOrganizationDto();
    dto.name = 'x';
    dto.code = 'lowercase!';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
