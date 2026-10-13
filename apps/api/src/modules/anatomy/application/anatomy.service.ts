import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  ANATOMY_REPOSITORY,
  assertFindingAction,
  type AnatomyFinding,
  type AnatomyRepository,
  type FindingAction,
  type FindingSeverity,
  type FindingLink,
  type Laterality,
  type LinkTargetType,
  type ModelStatus,
  type StructureLevel,
} from '../domain/anatomy.repository.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anatomical Mapping Engine application service (ANAT-001 §4, §9, §24–§26).
 * Geometry alone is never clinical meaning: structure + laterality + finding type
 * + provenance are the authoritative record; laterality is semantic, never derived
 * from camera/screen side (ANATOMY SAFETY RULE).
 */
@Injectable()
export class AnatomyService {
  constructor(
    @Inject(ANATOMY_REPOSITORY) private readonly repo: AnatomyRepository,
    private readonly outbox: OutboxService,
  ) {}

  async createModel(input: {
    vendor: string;
    modelName: string;
    version: string;
    anatomyProfile?: string;
    structureManifestVersion?: string;
    licence?: string;
    checksum?: string;
    status?: ModelStatus;
    correlationId?: string;
  }) {
    const existing = await this.repo.findModelByNameVersion(
      input.modelName,
      input.version,
    );
    if (existing) {
      throw new ConflictException({
        code: 'MODEL_EXISTS',
        message: 'Model name + version already exists (published versions are immutable)',
      });
    }
    const model = await this.repo.createModel({
      vendor: input.vendor,
      modelName: input.modelName,
      version: input.version,
      anatomyProfile: input.anatomyProfile ?? 'adult_general',
      structureManifestVersion: input.structureManifestVersion ?? '1',
      licence: input.licence ?? '',
      checksum: input.checksum ?? '',
      status: input.status ?? 'draft',
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_model',
      aggregateId: model.id,
      type: 'anatomy.model_created',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: { id: model.id, modelName: model.modelName, version: model.version, status: model.status },
    });
    return model;
  }

  listModels() {
    return this.repo.listModels();
  }

  async getModel(id: string) {
    const model = await this.repo.findModel(id);
    if (!model) {
      throw new NotFoundException({ code: 'MODEL_NOT_FOUND', message: 'Anatomy model not found' });
    }
    return model;
  }

  async createStructure(input: {
    modelId: string;
    vendorStructureKey: string;
    parentStructureId?: string;
    level: StructureLevel;
    name: string;
    code: string;
    correlationId?: string;
  }) {
    const model = await this.repo.findModel(input.modelId);
    if (!model) {
      throw new NotFoundException({ code: 'MODEL_NOT_FOUND', message: 'Anatomy model not found' });
    }
    if (input.parentStructureId) {
      const parent = await this.repo.findStructure(input.parentStructureId);
      if (!parent) {
        throw new NotFoundException({
          code: 'PARENT_STRUCTURE_NOT_FOUND',
          message: 'Parent structure not found',
        });
      }
      if (parent.modelId !== input.modelId) {
        throw new BadRequestException({
          code: 'PARENT_MODEL_MISMATCH',
          message: 'Parent structure must belong to the same model',
        });
      }
    }
    return this.repo.createStructure({
      modelId: input.modelId,
      vendorStructureKey: input.vendorStructureKey,
      parentStructureId: input.parentStructureId ?? null,
      level: input.level,
      name: input.name,
      code: input.code,
    });
  }

  async listStructures(modelId: string) {
    await this.getModel(modelId);
    return this.repo.listStructures(modelId);
  }

  async getStructure(id: string) {
    const structure = await this.repo.findStructure(id);
    if (!structure) {
      throw new NotFoundException({ code: 'STRUCTURE_NOT_FOUND', message: 'Anatomy structure not found' });
    }
    const mappings = await this.repo.listMappings(structure.id);
    return { ...structure, mappings };
  }

  async createMapping(input: {
    structureId: string;
    codingSystem: string;
    code: string;
    codeVersion?: string;
    approved?: boolean;
    correlationId?: string;
  }) {
    const structure = await this.repo.findStructure(input.structureId);
    if (!structure) {
      throw new NotFoundException({ code: 'STRUCTURE_NOT_FOUND', message: 'Anatomy structure not found' });
    }
    const mapping = await this.repo.createMapping({
      structureId: input.structureId,
      codingSystem: input.codingSystem,
      code: input.code,
      codeVersion: input.codeVersion ?? '',
      approved: input.approved ?? false,
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_structure',
      aggregateId: structure.id,
      type: 'anatomy.mapping_updated',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: {
        structureId: structure.id,
        codingSystem: mapping.codingSystem,
        code: mapping.code,
        approved: mapping.approved,
      },
    });
    return mapping;
  }

  async createFinding(input: {
    patientId: string;
    encounterId: string;
    facilityId: string;
    anatomyModelId: string;
    anatomyStructureId: string;
    laterality?: Laterality;
    findingType: string;
    findingText?: string;
    severity?: FindingSeverity;
    effectiveAt?: string;
    authorId: string;
    geometry?: unknown[];
    clientRef?: string;
    correlationId?: string;
  }) {
    if (input.clientRef) {
      const existing = await this.repo.findFindingByClientRef(
        input.facilityId,
        input.clientRef,
      );
      if (existing) return existing;
    }
    const model = await this.repo.findModel(input.anatomyModelId);
    if (!model) {
      throw new NotFoundException({ code: 'MODEL_NOT_FOUND', message: 'Anatomy model not found' });
    }
    if (model.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'MODEL_NOT_ACTIVE',
        message: `New annotations require an active model (model is ${model.status})`,
      });
    }
    const structure = await this.repo.findStructure(input.anatomyStructureId);
    if (!structure) {
      throw new NotFoundException({ code: 'STRUCTURE_NOT_FOUND', message: 'Anatomy structure not found' });
    }
    if (structure.modelId !== input.anatomyModelId) {
      throw new BadRequestException({
        code: 'STRUCTURE_MODEL_MISMATCH',
        message: 'Structure does not belong to the selected model',
      });
    }
    if (!structure.active) {
      throw new UnprocessableEntityException({
        code: 'STRUCTURE_INACTIVE',
        message: 'Structure is inactive and cannot be annotated',
      });
    }
    const encounterPatient = await this.repo.encounterPatientId(input.encounterId);
    if (!encounterPatient) {
      throw new NotFoundException({ code: 'ENCOUNTER_NOT_FOUND', message: 'Encounter not found' });
    }
    if (encounterPatient !== input.patientId) {
      throw new BadRequestException({
        code: 'ENCOUNTER_PATIENT_MISMATCH',
        message: 'Encounter does not belong to the patient',
      });
    }
    const finding = await this.repo.createFinding({
      patientId: input.patientId,
      encounterId: input.encounterId,
      facilityId: input.facilityId,
      anatomyModelId: input.anatomyModelId,
      anatomyStructureId: input.anatomyStructureId,
      laterality: input.laterality ?? null,
      findingType: input.findingType,
      findingText: input.findingText ?? '',
      severity: input.severity ?? null,
      effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
      authorId: input.authorId,
      geometry: input.geometry ?? [],
      clientRef: input.clientRef ?? null,
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_finding',
      aggregateId: finding.id,
      type: 'anatomy.finding_drafted',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: {
        id: finding.id,
        patientId: finding.patientId,
        encounterId: finding.encounterId,
        authorId: finding.authorId,
      },
    });
    return finding;
  }

  async getFinding(id: string) {
    const finding = await this.mustFind(id);
    const links = await this.repo.listLinks(finding.id);
    return { ...finding, links };
  }

  async listFindings(filter: { patientId: string; facilityId?: string; structureId?: string }) {
    if (!UUID_RE.test(filter.patientId)) {
      throw new BadRequestException({
        code: 'PATIENT_ID_INVALID',
        message: 'patientId (UUID) is required',
      });
    }
    return this.repo.listFindings(filter);
  }

  async updateDraft(
    id: string,
    input: {
      expectedVersion: number;
      laterality?: Laterality;
      findingType?: string;
      findingText?: string;
      severity?: FindingSeverity;
      effectiveAt?: string;
      geometry?: unknown[];
      correlationId?: string;
    },
  ) {
    const finding = await this.mustFind(id);
    this.guard(finding, 'update');
    const updated = await this.repo.updateDraft(id, input.expectedVersion, {
      ...(input.laterality !== undefined ? { laterality: input.laterality } : {}),
      ...(input.findingType !== undefined ? { findingType: input.findingType } : {}),
      ...(input.findingText !== undefined ? { findingText: input.findingText } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.effectiveAt !== undefined ? { effectiveAt: new Date(input.effectiveAt) } : {}),
      ...(input.geometry !== undefined ? { geometry: input.geometry } : {}),
    });
    if (!updated) {
      throw new ConflictException({
        code: 'FINDING_VERSION_CONFLICT',
        message: 'Finding was modified since load; reload and retry',
      });
    }
    return updated;
  }

  async sign(id: string, input: { signedBy: string; correlationId?: string }) {
    const finding = await this.mustFind(id);
    this.guard(finding, 'sign');
    const signed = await this.repo.setFindingStatus(id, 'signed', {
      signedBy: input.signedBy,
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_finding',
      aggregateId: id,
      type: 'anatomy.finding_signed',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: {
        id,
        structureId: signed.anatomyStructureId,
        findingType: signed.findingType,
        effectiveAt: signed.effectiveAt.toISOString(),
      },
    });
    return signed;
  }

  async amend(
    id: string,
    input: {
      amendmentReason: string;
      authorId: string;
      laterality?: Laterality;
      findingType?: string;
      findingText?: string;
      severity?: FindingSeverity;
      effectiveAt?: string;
      geometry?: unknown[];
      correlationId?: string;
    },
  ) {
    const prior = await this.mustFind(id);
    this.guard(prior, 'amend');
    const created = await this.repo.amendFinding(prior, {
      anatomyStructureId: prior.anatomyStructureId,
      laterality: input.laterality ?? prior.laterality ?? 'not_applicable',
      findingType: input.findingType ?? prior.findingType,
      findingText: input.findingText ?? prior.findingText,
      severity: input.severity ?? prior.severity,
      effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : prior.effectiveAt,
      authorId: input.authorId,
      geometry: input.geometry ?? prior.geometry,
      amendmentReason: input.amendmentReason,
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_finding',
      aggregateId: prior.id,
      type: 'anatomy.finding_amended',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: { newId: created.id, priorId: prior.id, reason: input.amendmentReason },
    });
    return created;
  }

  async enterError(id: string, input: { reason: string; correlationId?: string }) {
    const finding = await this.mustFind(id);
    this.guard(finding, 'enterError');
    const updated = await this.repo.setFindingStatus(id, 'entered_in_error', {
      errorReason: input.reason,
    });
    await this.outbox.publish({
      aggregateType: 'anatomy_finding',
      aggregateId: id,
      type: 'anatomy.finding_entered_in_error',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: { id, reason: input.reason },
    });
    return updated;
  }

  async linkFinding(
    id: string,
    input: { targetType: LinkTargetType; targetId: string; correlationId?: string },
  ): Promise<FindingLink> {
    const finding = await this.mustFind(id);
    const existing = (await this.repo.listLinks(finding.id)).find(
      (l) => l.targetType === input.targetType && l.targetId === input.targetId,
    );
    if (existing) return existing;
    const targetPatient = await this.repo.targetPatientId(input.targetType, input.targetId);
    if (!targetPatient) {
      throw new BadRequestException({
        code: 'LINK_TARGET_NOT_FOUND',
        message: `Link target not found for ${input.targetType}`,
      });
    }
    if (targetPatient !== finding.patientId) {
      throw new BadRequestException({
        code: 'LINK_PATIENT_MISMATCH',
        message: 'Link target belongs to a different patient',
      });
    }
    const link = await this.repo.addLink(finding.id, input.targetType, input.targetId);
    await this.outbox.publish({
      aggregateType: 'anatomy_finding',
      aggregateId: finding.id,
      type: 'anatomy.finding_linked',
      producer: 'anatomy',
      correlationId: input.correlationId,
      payload: { id: finding.id, targetType: input.targetType, targetId: input.targetId },
    });
    return link;
  }

  private async mustFind(id: string): Promise<AnatomyFinding> {
    const finding = await this.repo.findFinding(id);
    if (!finding) {
      throw new NotFoundException({ code: 'FINDING_NOT_FOUND', message: 'Anatomy finding not found' });
    }
    return finding;
  }

  private guard(finding: AnatomyFinding, action: FindingAction): void {
    try {
      assertFindingAction(finding, action);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('ANAT_LATERALITY_REQUIRED')) {
        throw new BadRequestException({
          code: 'ANAT_LATERALITY_REQUIRED',
          message:
            'Laterality is required to sign (use not_applicable/unknown when clinically meaningless)',
        });
      }
      throw new UnprocessableEntityException({
        code: 'ANAT_TRANSITION',
        message: `Illegal transition: ${message.replace('ANAT_TRANSITION:', '')}`,
      });
    }
  }
}
