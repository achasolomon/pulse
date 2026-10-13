import type {
  Department,
  Facility,
  Location,
  LocationKind,
  Organization,
  Unit,
} from '../domain/types.js';

/** Owned-application contract (BE-001 sections 9/16). Infrastructure implements; cross-domain imports this port only. */
export const ORGANIZATION_REPOSITORY = 'ORGANIZATION_REPOSITORY';

export interface OrganizationRepository {
  createOrganization(input: { name: string; code: string }): Promise<Organization>;
  createFacility(input: {
    organizationId: string;
    name: string;
    code: string;
  }): Promise<Facility>;
  listFacilities(organizationId: string): Promise<Facility[]>;
  findFacilityById(id: string): Promise<Facility | undefined>;
  createDepartment(input: {
    facilityId: string;
    name: string;
    code: string;
    parentDepartmentId?: string;
  }): Promise<Department>;
  listDepartments(facilityId: string): Promise<Department[]>;
  createUnit(input: {
    facilityId: string;
    name: string;
    code: string;
  }): Promise<Unit>;
  listUnits(facilityId: string): Promise<Unit[]>;
  createLocation(input: {
    unitId: string;
    facilityId: string;
    name: string;
    code: string;
    kind: LocationKind;
  }): Promise<Location>;
  listLocations(unitId: string): Promise<Location[]>;
}
