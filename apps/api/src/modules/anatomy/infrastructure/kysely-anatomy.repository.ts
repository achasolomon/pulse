import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  AnatomyFinding,
  AnatomyModel,
  AnatomyRepository,
  AnatomyStructure,
  FindingLink,
  FindingSeverity,
  FindingStatus,
  Laterality,
  LinkTargetType,
  ModelStatus,
  StructureLevel,
  StructureMapping,
} from '../domain/anatomy.repository.js';

const FINDING_COLS = [
  'id',
  'patient_id',
  'encounter_id',
  'facility_id',
  'anatomy_model_id',
  'anatomy_structure_id',
  'laterality',
  'finding_type',
  'finding_text',
  'severity',
  'effective_at',
  'recorded_at',
  'author_id',
  'status',
  'version',
  'geometry',
  'client_ref',
  'amends_id',
  'amendment_reason',
  'error_reason',
  'signed_by',
  'signed_at',
] as const;

@Injectable()
export class KyselyAnatomyRepository implements AnatomyRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createModel(input: {
    vendor: string;
    modelName: string;
    version: string;
    anatomyProfile: string;
    structureManifestVersion: string;
    licence: string;
    checksum: string;
    status: ModelStatus;
  }): Promise<AnatomyModel> {
    const r = await this.db
      .insertInto('anat.anatomy_model')
      .values({
        vendor: input.vendor,
        model_name: input.modelName,
        version: input.version,
        anatomy_profile: input.anatomyProfile,
        structure_manifest_version: input.structureManifestVersion,
        licence: input.licence,
        checksum: input.checksum,
        status: input.status,
        ...(input.status === 'active' ? { released_at: new Date() } : {}),
      })
      .returning([
        'id',
        'vendor',
        'model_name',
        'version',
        'anatomy_profile',
        'structure_manifest_version',
        'licence',
        'checksum',
        'status',
      ])
      .executeTakeFirstOrThrow();
    return this.mapModel(r);
  }

  async findModel(id: string): Promise<AnatomyModel | undefined> {
    const r = await this.db
      .selectFrom('anat.anatomy_model')
      .select([
        'id',
        'vendor',
        'model_name',
        'version',
        'anatomy_profile',
        'structure_manifest_version',
        'licence',
        'checksum',
        'status',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.mapModel(r) : undefined;
  }

  async findModelByNameVersion(modelName: string, version: string): Promise<AnatomyModel | undefined> {
    const r = await this.db
      .selectFrom('anat.anatomy_model')
      .select([
        'id',
        'vendor',
        'model_name',
        'version',
        'anatomy_profile',
        'structure_manifest_version',
        'licence',
        'checksum',
        'status',
      ])
      .where('model_name', '=', modelName)
      .where('version', '=', version)
      .executeTakeFirst();
    return r ? this.mapModel(r) : undefined;
  }

  async listModels(): Promise<AnatomyModel[]> {
    const rows = await this.db
      .selectFrom('anat.anatomy_model')
      .select([
        'id',
        'vendor',
        'model_name',
        'version',
        'anatomy_profile',
        'structure_manifest_version',
        'licence',
        'checksum',
        'status',
      ])
      .orderBy('model_name')
      .orderBy('version')
      .execute();
    return rows.map((r) => this.mapModel(r));
  }

  async createStructure(input: {
    modelId: string;
    vendorStructureKey: string;
    parentStructureId: string | null;
    level: StructureLevel;
    name: string;
    code: string;
  }): Promise<AnatomyStructure> {
    const r = await this.db
      .insertInto('anat.anatomy_structure')
      .values({
        model_id: input.modelId,
        vendor_structure_key: input.vendorStructureKey,
        parent_structure_id: input.parentStructureId,
        level: input.level,
        name: input.name,
        code: input.code,
      })
      .returning([
        'id',
        'model_id',
        'vendor_structure_key',
        'parent_structure_id',
        'level',
        'name',
        'code',
        'active',
      ])
      .executeTakeFirstOrThrow();
    return this.mapStructure(r);
  }

  async findStructure(id: string): Promise<AnatomyStructure | undefined> {
    const r = await this.db
      .selectFrom('anat.anatomy_structure')
      .select([
        'id',
        'model_id',
        'vendor_structure_key',
        'parent_structure_id',
        'level',
        'name',
        'code',
        'active',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.mapStructure(r) : undefined;
  }

  async listStructures(modelId: string): Promise<AnatomyStructure[]> {
    const rows = await this.db
      .selectFrom('anat.anatomy_structure')
      .select([
        'id',
        'model_id',
        'vendor_structure_key',
        'parent_structure_id',
        'level',
        'name',
        'code',
        'active',
      ])
      .where('model_id', '=', modelId)
      .orderBy('level')
      .orderBy('name')
      .execute();
    return rows.map((r) => this.mapStructure(r));
  }

  async createMapping(input: {
    structureId: string;
    codingSystem: string;
    code: string;
    codeVersion: string;
    approved: boolean;
  }): Promise<StructureMapping> {
    const r = await this.db
      .insertInto('anat.structure_mapping')
      .values({
        structure_id: input.structureId,
        coding_system: input.codingSystem,
        code: input.code,
        code_version: input.codeVersion,
        approved: input.approved,
      })
      .returning(['id', 'structure_id', 'coding_system', 'code', 'code_version', 'approved'])
      .executeTakeFirstOrThrow();
    return this.mapMapping(r);
  }

  async listMappings(structureId: string): Promise<StructureMapping[]> {
    const rows = await this.db
      .selectFrom('anat.structure_mapping')
      .select(['id', 'structure_id', 'coding_system', 'code', 'code_version', 'approved'])
      .where('structure_id', '=', structureId)
      .orderBy('coding_system')
      .execute();
    return rows.map((r) => this.mapMapping(r));
  }

  async createFinding(input: {
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
  }): Promise<AnatomyFinding> {
    const r = await this.db
      .insertInto('anat.finding')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId,
        facility_id: input.facilityId,
        anatomy_model_id: input.anatomyModelId,
        anatomy_structure_id: input.anatomyStructureId,
        laterality: input.laterality,
        finding_type: input.findingType,
        finding_text: input.findingText,
        severity: input.severity,
        effective_at: input.effectiveAt,
        author_id: input.authorId,
        geometry: JSON.stringify(input.geometry ?? []),
        client_ref: input.clientRef,
      })
      .returning(FINDING_COLS)
      .executeTakeFirstOrThrow();
    return this.mapFinding(r);
  }

  async findFinding(id: string): Promise<AnatomyFinding | undefined> {
    const r = await this.db
      .selectFrom('anat.finding')
      .select(FINDING_COLS)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.mapFinding(r) : undefined;
  }

  async findFindingByClientRef(facilityId: string, clientRef: string): Promise<AnatomyFinding | undefined> {
    const r = await this.db
      .selectFrom('anat.finding')
      .select(FINDING_COLS)
      .where('facility_id', '=', facilityId)
      .where('client_ref', '=', clientRef)
      .executeTakeFirst();
    return r ? this.mapFinding(r) : undefined;
  }

  async updateDraft(
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
  ): Promise<AnatomyFinding | undefined> {
    const r = await this.db
      .updateTable('anat.finding')
      .set({
        ...(patch.laterality !== undefined ? { laterality: patch.laterality } : {}),
        ...(patch.findingType !== undefined ? { finding_type: patch.findingType } : {}),
        ...(patch.findingText !== undefined ? { finding_text: patch.findingText } : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.effectiveAt !== undefined ? { effective_at: patch.effectiveAt } : {}),
        ...(patch.geometry !== undefined ? { geometry: JSON.stringify(patch.geometry) } : {}),
        version: expectedVersion + 1,
      })
      .where('id', '=', id)
      .where('status', '=', 'draft')
      .where('version', '=', expectedVersion)
      .returning(FINDING_COLS)
      .executeTakeFirst();
    return r ? this.mapFinding(r) : undefined;
  }

  async setFindingStatus(
    id: string,
    status: FindingStatus,
    extra?: { signedBy?: string; errorReason?: string },
  ): Promise<AnatomyFinding> {
    const r = await this.db
      .updateTable('anat.finding')
      .set({
        status,
        ...(extra?.signedBy
          ? { signed_by: extra.signedBy, signed_at: new Date() }
          : {}),
        ...(extra?.errorReason ? { error_reason: extra.errorReason } : {}),
      })
      .where('id', '=', id)
      .returning(FINDING_COLS)
      .executeTakeFirstOrThrow();
    return this.mapFinding(r);
  }

  async amendFinding(
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
  ): Promise<AnatomyFinding> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('anat.finding')
        .set({ status: 'amended' })
        .where('id', '=', prior.id)
        .where('status', '=', 'signed')
        .execute();
      const inserted = await trx
        .insertInto('anat.finding')
        .values({
          patient_id: prior.patientId,
          encounter_id: prior.encounterId,
          facility_id: prior.facilityId,
          anatomy_model_id: prior.anatomyModelId,
          anatomy_structure_id: input.anatomyStructureId,
          laterality: input.laterality,
          finding_type: input.findingType,
          finding_text: input.findingText,
          severity: input.severity,
          effective_at: input.effectiveAt,
          author_id: input.authorId,
          geometry: JSON.stringify(input.geometry ?? []),
          amends_id: prior.id,
          amendment_reason: input.amendmentReason,
        })
        .returning(FINDING_COLS)
        .executeTakeFirstOrThrow();
      return this.mapFinding(inserted);
    });
  }

  async listFindings(filter: {
    patientId: string;
    facilityId?: string;
    structureId?: string;
  }): Promise<AnatomyFinding[]> {
    let q = this.db
      .selectFrom('anat.finding')
      .select(FINDING_COLS)
      .where('patient_id', '=', filter.patientId);
    if (filter.facilityId) q = q.where('facility_id', '=', filter.facilityId);
    if (filter.structureId) q = q.where('anatomy_structure_id', '=', filter.structureId);
    const rows = await q.orderBy('effective_at', 'desc').limit(200).execute();
    return rows.map((r) => this.mapFinding(r));
  }

  async encounterPatientId(encounterId: string): Promise<string | undefined> {
    const r = await this.db
      .selectFrom('encounter.encounter')
      .select('patient_id')
      .where('id', '=', encounterId)
      .executeTakeFirst();
    return r?.patient_id;
  }

  async addLink(
    findingId: string,
    targetType: LinkTargetType,
    targetId: string,
  ): Promise<FindingLink> {
    const r = await this.db
      .insertInto('anat.finding_link')
      .values({ finding_id: findingId, target_type: targetType, target_id: targetId })
      .returning(['id', 'finding_id', 'target_type', 'target_id'])
      .executeTakeFirstOrThrow();
    return {
      id: r.id,
      findingId: r.finding_id,
      targetType: r.target_type as LinkTargetType,
      targetId: r.target_id,
    };
  }

  async listLinks(findingId: string): Promise<FindingLink[]> {
    const rows = await this.db
      .selectFrom('anat.finding_link')
      .select(['id', 'finding_id', 'target_type', 'target_id'])
      .where('finding_id', '=', findingId)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      findingId: r.finding_id,
      targetType: r.target_type as LinkTargetType,
      targetId: r.target_id,
    }));
  }

  async targetPatientId(targetType: LinkTargetType, targetId: string): Promise<string | undefined> {
    const table: Record<LinkTargetType, 'clin.entry' | 'clin.observation' | 'clin.note' | 'docs.document' | 'encounter.encounter'> = {
      condition: 'clin.entry',
      observation: 'clin.observation',
      note: 'clin.note',
      document: 'docs.document',
      encounter: 'encounter.encounter',
    };
    const r = await this.db
      .selectFrom(table[targetType])
      .select('patient_id')
      .where('id', '=', targetId)
      .executeTakeFirst();
    return r?.patient_id ?? undefined;
  }

  private mapModel(r: {
    id: string;
    vendor: string;
    model_name: string;
    version: string;
    anatomy_profile: string;
    structure_manifest_version: string;
    licence: string;
    checksum: string;
    status: string;
  }): AnatomyModel {
    return {
      id: r.id,
      vendor: r.vendor,
      modelName: r.model_name,
      version: r.version,
      anatomyProfile: r.anatomy_profile,
      structureManifestVersion: r.structure_manifest_version,
      licence: r.licence,
      checksum: r.checksum,
      status: r.status as AnatomyModel['status'],
    };
  }

  private mapStructure(r: {
    id: string;
    model_id: string;
    vendor_structure_key: string;
    parent_structure_id: string | null;
    level: string;
    name: string;
    code: string;
    active: boolean;
  }): AnatomyStructure {
    return {
      id: r.id,
      modelId: r.model_id,
      vendorStructureKey: r.vendor_structure_key,
      parentStructureId: r.parent_structure_id,
      level: r.level as AnatomyStructure['level'],
      name: r.name,
      code: r.code,
      active: r.active,
    };
  }

  private mapMapping(r: {
    id: string;
    structure_id: string;
    coding_system: string;
    code: string;
    code_version: string;
    approved: boolean;
  }): StructureMapping {
    return {
      id: r.id,
      structureId: r.structure_id,
      codingSystem: r.coding_system,
      code: r.code,
      codeVersion: r.code_version,
      approved: r.approved,
    };
  }

  private mapFinding(r: {
    id: string;
    patient_id: string;
    encounter_id: string;
    facility_id: string;
    anatomy_model_id: string;
    anatomy_structure_id: string;
    laterality: string | null;
    finding_type: string;
    finding_text: string;
    severity: string | null;
    effective_at: Date;
    recorded_at: Date;
    author_id: string;
    status: string;
    version: number;
    geometry: unknown;
    client_ref: string | null;
    amends_id: string | null;
    amendment_reason: string | null;
    error_reason: string | null;
    signed_by: string | null;
    signed_at: Date | null;
  }): AnatomyFinding {
    return {
      id: r.id,
      patientId: r.patient_id,
      encounterId: r.encounter_id,
      facilityId: r.facility_id,
      anatomyModelId: r.anatomy_model_id,
      anatomyStructureId: r.anatomy_structure_id,
      laterality: r.laterality as AnatomyFinding['laterality'],
      findingType: r.finding_type,
      findingText: r.finding_text,
      severity: r.severity as AnatomyFinding['severity'],
      effectiveAt: r.effective_at,
      recordedAt: r.recorded_at,
      authorId: r.author_id,
      status: r.status as AnatomyFinding['status'],
      version: r.version,
      geometry: Array.isArray(r.geometry) ? r.geometry : [],
      clientRef: r.client_ref,
      amendsId: r.amends_id,
      amendmentReason: r.amendment_reason,
      errorReason: r.error_reason,
      signedBy: r.signed_by,
      signedAt: r.signed_at,
    };
  }
}
