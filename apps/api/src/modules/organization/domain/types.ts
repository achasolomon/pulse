/** Organization domain (ARCH-001 §6, CLIN-001 facility profiles). */

export interface Organization {
  id: string;
  name: string;
  code: string;
}

export interface Facility {
  id: string;
  organizationId: string;
  name: string;
  code: string;
}

export interface Department {
  id: string;
  facilityId: string;
  name: string;
  code: string;
  parentDepartmentId?: string;
}

export interface Unit {
  id: string;
  facilityId: string;
  name: string;
  code: string;
}

export type LocationKind = 'bed' | 'room' | 'theatre' | 'clinic' | 'other';

export interface Location {
  id: string;
  unitId: string;
  facilityId: string;
  name: string;
  code: string;
  kind: LocationKind;
}
