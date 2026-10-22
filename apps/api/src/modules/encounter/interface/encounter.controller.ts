import {
  Body,
  Controller,
  Get,
  ForbiddenException,
  NotFoundException,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../../patient/domain/patient.repository.js';
import {
  ENCOUNTER_REPOSITORY,
  type EncounterRepository,
} from '../domain/encounter.repository.js';
import { EncounterService } from '../application/encounter.service.js';
import {
  AdmitDto,
  DischargeDto,
  OpenEncounterDto,
  SetCoverageDto,
  TransferDto,
} from './dto.js';

/** Encounter & ADT endpoints (EPIC-06). All tenant-scoped + audited. */
@Controller('encounters')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class EncounterController {
  constructor(
    private readonly encounters: EncounterService,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly repo: EncounterRepository,
  ) {}

  @Post()
  @RequirePrivilege({ action: 'write', resourceType: 'encounter' })
  @Audited({ action: 'encounter.open', resourceType: 'encounter' })
  async open(
    @Body() dto: OpenEncounterDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    if (dto.facilityId !== ctx?.facilityId)
      throw new ForbiddenException({
        code: 'FACILITY_MISMATCH',
        message: 'Use the selected facility',
      });
    const patient = await this.patients.findById(dto.patientId);
    if (!patient || patient.facilityId !== ctx.facilityId)
      throw new ForbiddenException({
        code: 'PATIENT_ACCESS_DENIED',
        message: 'Select a patient in this facility',
      });
    return this.encounters.open({
      patientId: dto.patientId,
      facilityId: dto.facilityId,
      type: dto.type,
      correlationId: ctx?.correlationId,
    });
  }

  @Get(':id')
  @RequirePrivilege({ action: 'read', resourceType: 'encounter' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    const encounter = await this.repo.findById(id);
    if (!encounter || encounter.facilityId !== ctx?.facilityId)
      throw new NotFoundException({
        code: 'ENCOUNTER_NOT_FOUND',
        message: 'Encounter is unavailable in this facility',
      });
    return encounter;
  }

  @Get(':id/history')
  @RequirePrivilege({ action: 'read', resourceType: 'encounter' })
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    await this.get(id, ctx);
    return this.repo.listHistory(id);
  }

  @Post(':id/admit')
  @RequirePrivilege({ action: 'admit', resourceType: 'encounter' })
  @Audited({ action: 'encounter.admit', resourceType: 'encounter' })
  admit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdmitDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.encounters.admit(id, {
      departmentId: dto.departmentId,
      ...(dto.bed ? { bed: dto.bed } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post(':id/transfer')
  @RequirePrivilege({ action: 'transfer', resourceType: 'encounter' })
  @Audited({ action: 'encounter.transfer', resourceType: 'encounter' })
  transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransferDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.encounters.transfer(id, {
      departmentId: dto.departmentId,
      ...(dto.bed ? { bed: dto.bed } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post(':id/discharge')
  @RequirePrivilege({ action: 'discharge', resourceType: 'encounter' })
  @Audited({ action: 'encounter.discharge', resourceType: 'encounter' })
  discharge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DischargeDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.encounters.discharge(id, {
      ...(dto.disposition ? { disposition: dto.disposition } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post(':id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'encounter' })
  @Audited({ action: 'encounter.cancel', resourceType: 'encounter' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.encounters.cancel(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/coverage')
  @RequirePrivilege({ action: 'manage', resourceType: 'encounter' })
  @Audited({ action: 'encounter.coverage_set', resourceType: 'encounter' })
  setCoverage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetCoverageDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.encounters.setCoverage(id, dto.coverageId, {
      correlationId: ctx?.correlationId,
    });
  }
}
