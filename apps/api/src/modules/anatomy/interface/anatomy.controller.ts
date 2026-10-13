import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { AnatomyService } from '../application/anatomy.service.js';
import {
  AmendFindingDto,
  CreateFindingDto,
  CreateMappingDto,
  CreateModelDto,
  CreateStructureDto,
  EnterErrorDto,
  LinkFindingDto,
  SignFindingDto,
  UpdateFindingDto,
} from './dto.js';

/**
 * Anatomical Mapping Engine endpoints (ANAT-001 §24–§25). Catalogue is
 * platform reference data; findings are facility-scoped clinical records.
 * All routes require tenant + facility context (ANAT-001 §29).
 */
@Controller('anatomy')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class AnatomyController {
  constructor(private readonly anatomy: AnatomyService) {}

  @Post('models')
  @RequirePrivilege({ action: 'manage', resourceType: 'anatomy_catalog' })
  @Audited({ action: 'anatomy.model_create', resourceType: 'anatomy_catalog' })
  createModel(@Body() dto: CreateModelDto, @CurrentContext() ctx?: RequestContext) {
    return this.anatomy.createModel({
      vendor: dto.vendor,
      modelName: dto.modelName,
      version: dto.version,
      ...(dto.anatomyProfile ? { anatomyProfile: dto.anatomyProfile } : {}),
      ...(dto.structureManifestVersion
        ? { structureManifestVersion: dto.structureManifestVersion }
        : {}),
      ...(dto.licence ? { licence: dto.licence } : {}),
      ...(dto.checksum ? { checksum: dto.checksum } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('models')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy_catalog' })
  listModels() {
    return this.anatomy.listModels();
  }

  @Get('models/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy_catalog' })
  getModel(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.anatomy.getModel(id);
  }

  @Post('models/:id/structures')
  @RequirePrivilege({ action: 'manage', resourceType: 'anatomy_catalog' })
  @Audited({ action: 'anatomy.structure_create', resourceType: 'anatomy_catalog' })
  createStructure(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateStructureDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.createStructure({
      modelId: id,
      vendorStructureKey: dto.vendorStructureKey,
      ...(dto.parentStructureId ? { parentStructureId: dto.parentStructureId } : {}),
      level: dto.level,
      name: dto.name,
      code: dto.code,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('models/:id/structures')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy_catalog' })
  listStructures(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.anatomy.listStructures(id);
  }

  @Get('structures/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy_catalog' })
  getStructure(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.anatomy.getStructure(id);
  }

  @Post('structures/:id/mappings')
  @RequirePrivilege({ action: 'manage', resourceType: 'terminology' })
  @Audited({ action: 'anatomy.mapping_update', resourceType: 'terminology' })
  createMapping(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateMappingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.createMapping({
      structureId: id,
      codingSystem: dto.codingSystem,
      code: dto.code,
      ...(dto.codeVersion ? { codeVersion: dto.codeVersion } : {}),
      ...(dto.approved !== undefined ? { approved: dto.approved } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('findings')
  @RequirePrivilege({ action: 'document', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_draft', resourceType: 'anatomy_finding' })
  createFinding(@Body() dto: CreateFindingDto, @CurrentContext() ctx?: RequestContext) {
    return this.anatomy.createFinding({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      facilityId: this.facility(ctx),
      anatomyModelId: dto.anatomyModelId,
      anatomyStructureId: dto.anatomyStructureId,
      ...(dto.laterality ? { laterality: dto.laterality } : {}),
      findingType: dto.findingType,
      ...(dto.findingText ? { findingText: dto.findingText } : {}),
      ...(dto.severity ? { severity: dto.severity } : {}),
      ...(dto.effectiveAt ? { effectiveAt: dto.effectiveAt } : {}),
      authorId: dto.authorId,
      ...(dto.geometry ? { geometry: dto.geometry } : {}),
      ...(dto.clientRef ? { clientRef: dto.clientRef } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('findings')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy' })
  listFindings(
    @Query('patientId') patientId?: string,
    @Query('structureId') structureId?: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    if (!patientId) {
      throw new BadRequestException({
        code: 'PATIENT_ID_REQUIRED',
        message: 'patientId (UUID) query parameter is required',
      });
    }
    return this.anatomy.listFindings({
      patientId,
      facilityId: this.facility(ctx),
      ...(structureId ? { structureId } : {}),
    });
  }

  @Get('findings/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'anatomy' })
  getFinding(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.anatomy.getFinding(id);
  }

  @Patch('findings/:id')
  @RequirePrivilege({ action: 'document', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_update', resourceType: 'anatomy_finding' })
  updateDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.updateDraft(id, {
      expectedVersion: dto.expectedVersion,
      ...(dto.laterality ? { laterality: dto.laterality } : {}),
      ...(dto.findingType ? { findingType: dto.findingType } : {}),
      ...(dto.findingText !== undefined ? { findingText: dto.findingText } : {}),
      ...(dto.severity ? { severity: dto.severity } : {}),
      ...(dto.effectiveAt ? { effectiveAt: dto.effectiveAt } : {}),
      ...(dto.geometry ? { geometry: dto.geometry } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('findings/:id/sign')
  @RequirePrivilege({ action: 'sign', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_sign', resourceType: 'anatomy_finding' })
  sign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SignFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.sign(id, {
      signedBy: dto.signedBy,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('findings/:id/amend')
  @RequirePrivilege({ action: 'amend', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_amend', resourceType: 'anatomy_finding' })
  amend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AmendFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.amend(id, {
      amendmentReason: dto.amendmentReason,
      authorId: dto.authorId,
      ...(dto.laterality ? { laterality: dto.laterality } : {}),
      ...(dto.findingType ? { findingType: dto.findingType } : {}),
      ...(dto.findingText !== undefined ? { findingText: dto.findingText } : {}),
      ...(dto.severity ? { severity: dto.severity } : {}),
      ...(dto.effectiveAt ? { effectiveAt: dto.effectiveAt } : {}),
      ...(dto.geometry ? { geometry: dto.geometry } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('findings/:id/enter-error')
  @RequirePrivilege({ action: 'amend', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_enter_error', resourceType: 'anatomy_finding' })
  enterError(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EnterErrorDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.enterError(id, {
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('findings/:id/links')
  @RequirePrivilege({ action: 'document', resourceType: 'anatomy' })
  @Audited({ action: 'anatomy.finding_link', resourceType: 'anatomy_finding' })
  link(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LinkFindingDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.anatomy.linkFinding(id, {
      targetType: dto.targetType,
      targetId: dto.targetId,
      correlationId: ctx?.correlationId,
    });
  }

  private facility(ctx?: RequestContext): string {
    if (!ctx?.facilityId) {
      throw new ForbiddenException({
        code: 'FACILITY_CONTEXT_REQUIRED',
        message: 'Facility context required for anatomy findings',
      });
    }
    return ctx.facilityId;
  }
}
