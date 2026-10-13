import {
  Body,
  Controller,
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
import { MedicationService } from '../application/medication.service.js';
import { AdministerDto, DefineMedicationDto, DispenseDto, HoldCancelDto, PrescribeDto } from './dto.js';

/** Medication endpoints (EPIC-12). All tenant-scoped + audited. */
@Controller('medications')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class MedicationController {
  constructor(private readonly meds: MedicationService) {}

  @Post('catalog')
  @RequirePrivilege({ action: 'manage', resourceType: 'med_catalog' })
  @Audited({ action: 'med.define', resourceType: 'med_catalog' })
  define(@Body() dto: DefineMedicationDto) {
    return this.meds.defineMedication({
      code: dto.code,
      name: dto.name,
      doseForm: dto.doseForm ?? '',
      strength: dto.strength ?? '',
      route: dto.route ?? '',
    });
  }

  @Post('prescriptions')
  @RequirePrivilege({ action: 'prescribe', resourceType: 'medication' })
  @Audited({ action: 'med.prescribe', resourceType: 'med_request' })
  prescribe(@Body() dto: PrescribeDto, @CurrentContext() ctx?: RequestContext) {
    return this.meds.prescribe({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      medicationCode: dto.medicationCode,
      dose: dto.dose,
      doseUnit: dto.doseUnit ?? '',
      route: dto.route,
      frequency: dto.frequency,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('prescriptions/:id/verify')
  @RequirePrivilege({ action: 'verify', resourceType: 'medication' })
  @Audited({ action: 'med.verify', resourceType: 'med_request' })
  verify(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.meds.verify(id, { correlationId: ctx?.correlationId });
  }

  @Post('prescriptions/:id/dispense')
  @RequirePrivilege({ action: 'dispense', resourceType: 'medication' })
  @Audited({ action: 'med.dispense', resourceType: 'med_request' })
  dispense(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DispenseDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.meds.dispense(id, {
      quantity: dto.quantity,
      batch: dto.batch ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Post('prescriptions/:id/hold')
  @RequirePrivilege({ action: 'hold', resourceType: 'medication' })
  @Audited({ action: 'med.hold', resourceType: 'med_request' })
  hold(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: HoldCancelDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.meds.hold(id, { reason: dto.reason, correlationId: ctx?.correlationId });
  }

  @Post('prescriptions/:id/resume')
  @RequirePrivilege({ action: 'resume', resourceType: 'medication' })
  @Audited({ action: 'med.resume', resourceType: 'med_request' })
  resume(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.meds.resume(id, { correlationId: ctx?.correlationId });
  }

  @Post('prescriptions/:id/complete')
  @RequirePrivilege({ action: 'complete', resourceType: 'medication' })
  @Audited({ action: 'med.complete', resourceType: 'med_request' })
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.meds.complete(id, { correlationId: ctx?.correlationId });
  }

  @Post('prescriptions/:id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'medication' })
  @Audited({ action: 'med.cancel', resourceType: 'med_request' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: HoldCancelDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.meds.cancel(id, { reason: dto.reason, correlationId: ctx?.correlationId });
  }

  @Post('prescriptions/:id/administrations')
  @RequirePrivilege({ action: 'administer', resourceType: 'medication' })
  @Audited({ action: 'med.administer', resourceType: 'med_request' })
  administer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdministerDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.meds.administer(id, {
      doseGiven: dto.doseGiven,
      outcome: dto.outcome,
      reason: dto.reason ?? '',
      correlationId: ctx?.correlationId,
    });
  }
}
