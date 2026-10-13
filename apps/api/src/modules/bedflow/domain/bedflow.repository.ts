/**
 * ICU/HDU bed-flow domain (EPIC-25, CLIN-001 section 13). Beds are
 * org.location rows with kind='bed' (Sprint 27 hierarchy) enriched with level
 * of care and operational state. Occupancy truth is the active assignment row
 * — reservation alone is never admission. Level-of-care history is preserved;
 * the latest active row is current.
 */

export type CareLevel = 'ward' | 'hdu' | 'icu';
export type AssignmentStatus = 'active' | 'ended';
export type LevelStatus = 'active' | 'ended';

export interface Bed {
  id: string;
  unitId: string;
  facilityId: string;
  name: string;
  code: string;
  levelOfCare?: CareLevel;
  isolationCapable: boolean;
  outOfService: boolean;
  outOfServiceReason?: string;
  /** Derived: no active assignment and not out of service. */
  available?: boolean;
}

export interface BedAssignment {
  id: string;
  locationId: string;
  encounterId: string;
  facilityId: string;
  status: AssignmentStatus;
  startsAt: string;
  endedAt?: string;
}

export interface LevelOfCare {
  id: string;
  encounterId: string;
  level: CareLevel;
  reason: string;
  status: LevelStatus;
  startsAt: string;
  endedAt?: string;
}

export const BEDFLOW_REPOSITORY = 'BEDFLOW_REPOSITORY';

export interface BedflowRepository {
  getLocation(id: string): Promise<Bed | undefined>;
  configureBed(
    id: string,
    input: { levelOfCare: CareLevel; isolationCapable: boolean },
  ): Promise<void>;
  setOutOfService(id: string, input: { outOfService: boolean; reason?: string }): Promise<void>;
  listBeds(filter: { facilityId: string; level?: CareLevel }): Promise<Bed[]>;
  createAssignment(input: {
    locationId: string;
    encounterId: string;
    facilityId: string;
  }): Promise<BedAssignment>;
  getAssignment(id: string): Promise<BedAssignment | undefined>;
  getActiveAssignmentByEncounter(encounterId: string): Promise<BedAssignment | undefined>;
  getActiveAssignmentByBed(locationId: string): Promise<BedAssignment | undefined>;
  listAssignments(filter: {
    facilityId?: string;
    encounterId?: string;
    status?: AssignmentStatus;
  }): Promise<BedAssignment[]>;
  endAssignment(id: string, endedAt: Date): Promise<void>;
  getActiveLevel(encounterId: string): Promise<LevelOfCare | undefined>;
  listLevels(encounterId: string): Promise<LevelOfCare[]>;
  createLevel(input: {
    encounterId: string;
    level: CareLevel;
    reason: string;
  }): Promise<LevelOfCare>;
  endActiveLevel(encounterId: string, endedAt: Date): Promise<void>;
}

/**
 * Effective level of care: no active level row means ward (default acuity).
 * ICU/HDU level gates (CLIN-001 13.1 higher-acuity workflow) read this.
 */
export function effectiveLevel(active: CareLevel | undefined): CareLevel {
  return active ?? 'ward';
}

/**
 * Which encounter levels may occupy a bed of the given level.
 * - ward beds: any level (step-down to ward is routine)
 * - hdu beds: hdu or icu (icu patients may overflow to hdu)
 * - icu beds: icu only (the higher-acuity workflow gate)
 */
export function bedAcceptsLevel(bedLevel: CareLevel, encounterLevel: CareLevel): boolean {
  if (bedLevel === 'ward') return true;
  if (bedLevel === 'hdu') return encounterLevel === 'hdu' || encounterLevel === 'icu';
  return encounterLevel === 'icu';
}

/** Occupancy truth: available = not out of service and no active assignment. */
export function isBedAvailable(input: {
  outOfService: boolean;
  activeAssignment?: unknown;
}): boolean {
  return !input.outOfService && !input.activeAssignment;
}
