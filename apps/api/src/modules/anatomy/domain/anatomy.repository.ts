/** Anatomy domain (ANAT-001 §4, §9, §44: Release-1 backend subset). */

export type ModelStatus = 'draft' | 'validation' | 'active' | 'retired' | 'withdrawn';

export type StructureLevel =
  | 'system'
  | 'region'
  | 'structure'
  | 'substructure'
  | 'landmark';

export type Laterality =
  | 'left'
  | 'right'
  | 'bilateral'
  | 'midline'
  | 'not_applicable'
  | 'unknown';

export type FindingSeverity = 'mild' | 'moderate' | 'severe';

export type FindingStatus = 'draft' | 'signed' | 'amended' | 'entered_in_error';

export type FindingAction = 'update' | 'sign' | 'amend' | 'enterError';

export type LinkTargetType = 'condition' | 'observation' | 'note' | 'document' | 'encounter';

export interface AnatomyModel {
  id: string;
  vendor: string;
  modelName: string;
  version: string;
  anatomyProfile: string;
  structureManifestVersion: string;
  licence: string;
  checksum: string;
  status: ModelStatus;
}

export interface AnatomyStructure {
  id: string;
  modelId: string;
  vendorStructureKey: string;
  parentStructureId: string | null;
  level: StructureLevel;
  name: string;
  code: string;
  active: boolean;
}

export interface StructureMapping {
  id: string;
  structureId: string;
  codingSystem: string;
  code: string;
  codeVersion: string;
  approved: boolean;
}

export interface AnatomyFinding {
  id: string;
  patientId: string;
  encounterId: string;
  facilityId: string;
  anatomyModelId: string;
  anatomyStructureId: string;
  laterality: Laterality | null;
  findingType: string;
  findingText: string;
  severity: FindingSeverity | null;
  effectiveAt: Date;
  recordedAt: Date;
  authorId: string;
  status: FindingStatus;
  version: number;
  geometry: unknown[];
  clientRef: string | null;
  amendsId: string | null;
  amendmentReason: string | null;
  errorReason: string | null;
  signedBy: string | null;
  signedAt: Date | null;
}

export interface FindingLink {
  id: string;
  findingId: string;
  targetType: LinkTargetType;
  targetId: string;
}

/**
 * Pure finding action guard (ANAT-001 §9, §25, safety rule §34).
 * Throws Error('ANAT_TRANSITION:<status>-><action>') on illegal moves and
 * Error('ANAT_LATERALITY_REQUIRED:sign') when signing without semantic laterality
 * (never derive laterality from camera/screen side).
 */
export function assertFindingAction(
  finding: Pick<AnatomyFinding, 'status' | 'laterality'>,
  action: FindingAction,
): void {
  const legal: Record<FindingStatus, FindingAction[]> = {
    draft: ['update', 'sign', 'enterError'],
    signed: ['amend', 'enterError'],
    amended: [],
    entered_in_error: [],
  };
  if (!legal[finding.status].includes(action)) {
    throw new Error(`ANAT_TRANSITION:${finding.status}->${action}`);
  }
  if (action === 'sign' && finding.laterality === null) {
    throw new Error('ANAT_LATERALITY_REQUIRED:sign');
  }
}

export const ANATOMY_REPOSITORY = 'ANATOMY_REPOSITORY';

export interface AnatomyRepository {
  createModel(input: {
    vendor: string;
    modelName: string;
    version: string;
    anatomyProfile: string;
    structureManifestVersion: string;
    licence: string;
    checksum: string;
    status: ModelStatus;
  }): Promise<AnatomyModel>;
  findModel(id: string): Promise<AnatomyModel | undefined>;
  findModelByNameVersion(modelName: string, version: string): Promise<AnatomyModel | undefined>;
  listModels(): Promise<AnatomyModel[]>;

  createStructure(input: {
    modelId: string;
    vendorStructureKey: string;
    parentStructureId: string | null;
    level: StructureLevel;
    name: string;
    code: string;
  }): Promise<AnatomyStructure>;
  findStructure(id: string): Promise<AnatomyStructure | undefined>;
  listStructures(modelId: string): Promise<AnatomyStructure[]>;

  createMapping(input: {
    structureId: string;
    codingSystem: string;
    code: string;
    codeVersion: string;
    approved: boolean;
  }): Promise<StructureMapping>;
  listMappings(structureId: string): Promise<StructureMapping[]>;

  createFinding(input: {
    patientId: string;
    encounterId: string;
    facilityId: string;
    anatomyModelId: string;
    anatomyStructureId: string;
    laterality: Laterality | null;
    findingType: string;
    findingText: string;
    severity: FindingSeverity | null;
    effectiveAt: Date;
    authorId: string;
    geometry: unknown[];
    clientRef: string | null;
  }): Promise<AnatomyFinding>;
  findFinding(id: string): Promise<AnatomyFinding | undefined>;
  findFindingByClientRef(facilityId: string, clientRef: string): Promise<AnatomyFinding | undefined>;
  /** Optimistic-concurrency draft update; undefined = expectedVersion conflict. */
  updateDraft(
    id: string,
    expectedVersion: number,
    patch: {
      laterality?: Laterality;
      findingType?: string;
      findingText?: string;
      severity?: FindingSeverity;
      effectiveAt?: Date;
      geometry?: unknown[];
    },
  ): Promise<AnatomyFinding | undefined>;
  setFindingStatus(
    id: string,
    status: FindingStatus,
    extra?: { signedBy?: string; errorReason?: string },
  ): Promise<AnatomyFinding>;
  /** Transactional amend: prior signed -> amended, new draft row with amends_id. */
  amendFinding(
    prior: AnatomyFinding,
    input: {
      anatomyStructureId: string;
      laterality: Laterality;
      findingType: string;
      findingText: string;
      severity: FindingSeverity | null;
      effectiveAt: Date;
      authorId: string;
      geometry: unknown[];
      amendmentReason: string;
    },
  ): Promise<AnatomyFinding>;
  listFindings(filter: {
    patientId: string;
    facilityId?: string;
    structureId?: string;
  }): Promise<AnatomyFinding[]>;

  encounterPatientId(encounterId: string): Promise<string | undefined>;

  addLink(findingId: string, targetType: LinkTargetType, targetId: string): Promise<FindingLink>;
  listLinks(findingId: string): Promise<FindingLink[]>;
  targetPatientId(targetType: LinkTargetType, targetId: string): Promise<string | undefined>;
}
