import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { PatientService } from '../application/patient.service.js';
import { StaffPatientReadService } from '../application/staff-patient-read.service.js';
import type { PatientRepository } from '../domain/patient.repository.js';
import { PATIENT_REPOSITORY } from '../domain/patient.repository.js';
import { Inject } from '@nestjs/common';
import { MergePatientDto, RegisterPatientDto, SetGuarantorDto } from './dto.js';

/**
 * Patient identity endpoints (EPIC-04). All facility-scoped + audited.
 * Banner (F04.5) consumes GET /patients/:id/summary.
 */
@Controller('patients')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class PatientController {
  constructor(
    private readonly patients: PatientService,
    private readonly reads: StaffPatientReadService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  @Post()
  @RequirePrivilege({ action: 'write', resourceType: 'patient' })
  @Audited({ action: 'patient.register', resourceType: 'patient' })
  register(
    @Body() dto: RegisterPatientDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    if (dto.facilityId !== ctx?.facilityId)
      throw new ForbiddenException({
        code: 'FACILITY_MISMATCH',
        message: 'Use the selected facility',
      });
    return this.patients.register({
      familyName: dto.familyName,
      givenName: dto.givenName,
      dateOfBirth: dto.dateOfBirth,
      sex: dto.sex,
      facilityId: dto.facilityId,
      ...(dto.mrn ? { mrn: dto.mrn } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('search')
  @Header('Cache-Control', 'no-store')
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  search(
    @Query('q') q: string,
    @Query('facilityId') facilityId: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    if (facilityId && facilityId !== ctx?.facilityId)
      throw new ForbiddenException({
        code: 'FACILITY_MISMATCH',
        message: 'Use the selected facility',
      });
    return this.repo.search({
      query: (q ?? '').slice(0, 100),
      facilityId: ctx!.facilityId!,
      limit: 25,
    });
  }

  @Get(':id/summary')
  @Header('Cache-Control', 'no-store')
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  async summary(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('authorization') authorization?: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    const scope = await this.reads.scope(
      authorization,
      ctx?.facilityId,
      ctx?.tenantId,
    );
    await this.reads.identity(scope, id);
    return this.repo.findById(id);
  }

  @Get(':id/duplicates')
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  async duplicates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('facilityId') facilityId: string,
    @CurrentContext() ctx?: RequestContext,
  ) {
    if (facilityId && facilityId !== ctx?.facilityId)
      throw new ForbiddenException({
        code: 'FACILITY_MISMATCH',
        message: 'Use the selected facility',
      });
    await this.scopedRecord(id, ctx?.facilityId);
    return this.patients.duplicates(id, ctx!.facilityId!);
  }

  @Post(':id/merge')
  @RequirePrivilege({ action: 'merge', resourceType: 'patient' })
  @Audited({ action: 'patient.merge', resourceType: 'patient' })
  async merge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MergePatientDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    await this.scopedRecord(id, ctx?.facilityId);
    await this.scopedRecord(dto.survivorId, ctx?.facilityId);
    return this.patients.merge({
      survivorId: dto.survivorId,
      duplicateId: id,
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post(':id/guarantor')
  @RequirePrivilege({ action: 'manage', resourceType: 'patient' })
  @Audited({ action: 'patient.guarantor_set', resourceType: 'patient' })
  async guarantor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetGuarantorDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    await this.scopedRecord(id, ctx?.facilityId);
    return this.patients.setGuarantor(id, {
      name: dto.name,
      ...(dto.contact ? { contact: dto.contact } : {}),
      correlationId: ctx?.correlationId,
    });
  }
  private async scopedRecord(id: string, facilityId?: string) {
    const patient = await this.repo.findById(id);
    if (!patient || patient.facilityId !== facilityId)
      throw new NotFoundException({
        code: 'PATIENT_NOT_FOUND',
        message: 'Patient is unavailable in this facility',
      });
    return patient;
  }
}
