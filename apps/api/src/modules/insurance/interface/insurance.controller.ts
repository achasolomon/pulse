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
import { InsuranceService } from '../application/insurance.service.js';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class DefinePayerDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;
}

export class SignContractDto {
  @IsUUID()
  facilityId!: string;

  @IsUUID()
  payerId!: string;

  @IsString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  effectiveTo?: string;
}

export class PublishScheduleDto {
  @IsString()
  effectiveFrom!: string;

  lines!: { serviceCode: string; price: number }[];
}

export class CheckEligibilityDto {
  @IsUUID()
  coverageId!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @IsIn(['manual', 'payer-query'])
  method!: 'manual' | 'payer-query';

  @IsString()
  evidence!: string;

  @IsOptional()
  @IsUUID()
  verifiedBy?: string;

  @IsIn(['eligible', 'ineligible', 'partial'])
  result!: 'eligible' | 'ineligible' | 'partial';
}

export class OpenPreauthDto {
  @IsUUID()
  coverageId!: string;

  @IsUUID()
  encounterId!: string;
}

export class DecidePreauthDto {
  @IsIn(['approve', 'deny'])
  decision!: 'approve' | 'deny';

  @IsOptional()
  @IsString()
  decisionNote?: string;

  @IsOptional()
  @IsString()
  expiresOn?: string;
}

export class DefineBenefitDto {
  @IsString()
  payerCode!: string;

  @IsString()
  plan!: string;

  @IsNumber()
  @Min(0)
  deductibleAnnual!: number;

  @IsNumber()
  @Min(0)
  copayAmount!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  coinsurancePct!: number;

  @IsString()
  effectiveFrom!: string;
}

export class ApplyBenefitsDto {
  @IsUUID()
  chargeId!: string;

  @IsUUID()
  coverageId!: string;

  @IsOptional()
  @IsString()
  onDate?: string;
}

/** Insurance endpoints (CR-001 Phase 1a). Read/admin only; no billing behavior changes. */
@Controller('insurance')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class InsuranceController {
  constructor(private readonly insurance: InsuranceService) {}

  @Post('payers')
  @RequirePrivilege({ action: 'manage', resourceType: 'payer' })
  @Audited({ action: 'payer.define', resourceType: 'payer' })
  definePayer(@Body() dto: DefinePayerDto, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.definePayer({
      code: dto.code,
      name: dto.name,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('contracts')
  @RequirePrivilege({ action: 'manage', resourceType: 'payer' })
  @Audited({ action: 'contract.sign', resourceType: 'facility_contract' })
  signContract(@Body() dto: SignContractDto, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.signContract({
      facilityId: dto.facilityId,
      payerId: dto.payerId,
      effectiveFrom: dto.effectiveFrom,
      ...(dto.effectiveTo ? { effectiveTo: dto.effectiveTo } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('contracts/:id/schedules')
  @RequirePrivilege({ action: 'manage', resourceType: 'payer' })
  @Audited({ action: 'tariff.publish', resourceType: 'tariff_schedule' })
  publishSchedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PublishScheduleDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.insurance.publishSchedule(id, {
      effectiveFrom: dto.effectiveFrom,
      lines: dto.lines,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('eligibility')
  @RequirePrivilege({ action: 'verify', resourceType: 'coverage' })
  @Audited({ action: 'eligibility.record', resourceType: 'eligibility' })
  eligibility(@Body() dto: CheckEligibilityDto, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.checkEligibility({
      coverageId: dto.coverageId,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      method: dto.method,
      evidence: dto.evidence,
      ...(dto.verifiedBy ? { verifiedBy: dto.verifiedBy } : {}),
      result: dto.result,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('preauth')
  @RequirePrivilege({ action: 'request', resourceType: 'preauth' })
  @Audited({ action: 'preauth.request', resourceType: 'preauth' })
  openPreauth(@Body() dto: OpenPreauthDto, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.openPreauth({
      coverageId: dto.coverageId,
      encounterId: dto.encounterId,
      lines: [],
      correlationId: ctx?.correlationId,
    });
  }

  @Post('preauth/:id/request-docs')
  @RequirePrivilege({ action: 'review', resourceType: 'preauth' })
  @Audited({ action: 'preauth.request_docs', resourceType: 'preauth' })
  requestDocs(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.requestPreauthDocs(id, { correlationId: ctx?.correlationId });
  }

  @Post('preauth/:id/resubmit')
  @RequirePrivilege({ action: 'request', resourceType: 'preauth' })
  @Audited({ action: 'preauth.resubmit', resourceType: 'preauth' })
  resubmitPreauth(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.resubmitPreauth(id, { correlationId: ctx?.correlationId });
  }

  @Post('preauth/:id/decide')
  @RequirePrivilege({ action: 'decide', resourceType: 'preauth' })
  @Audited({ action: 'preauth.decide', resourceType: 'preauth' })
  decidePreauth(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecidePreauthDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.insurance.decidePreauth(id, {
      approved: dto.decision === 'approve',
      ...(dto.decisionNote ? { decisionNote: dto.decisionNote } : {}),
      ...(dto.expiresOn ? { expiresOn: dto.expiresOn } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('preauth/:id/expire')
  @RequirePrivilege({ action: 'review', resourceType: 'preauth' })
  @Audited({ action: 'preauth.expire', resourceType: 'preauth' })
  expirePreauth(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.expirePreauth(id, { correlationId: ctx?.correlationId });
  }

  @Post('preauth/:id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'preauth' })
  @Audited({ action: 'preauth.cancel', resourceType: 'preauth' })
  cancelPreauth(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.cancelPreauth(id, { correlationId: ctx?.correlationId });
  }

  @Post('benefits')
  @RequirePrivilege({ action: 'manage', resourceType: 'payer' })
  @Audited({ action: 'benefit.define', resourceType: 'plan_benefit' })
  defineBenefit(@Body() dto: DefineBenefitDto) {
    return this.insurance.defineBenefit({
      payerCode: dto.payerCode,
      plan: dto.plan,
      deductibleAnnual: dto.deductibleAnnual,
      copayAmount: dto.copayAmount,
      coinsurancePct: dto.coinsurancePct,
      effectiveFrom: dto.effectiveFrom,
    });
  }

  @Post('benefits/apply')
  @RequirePrivilege({ action: 'apply', resourceType: 'benefit' })
  @Audited({ action: 'benefit.apply', resourceType: 'charge' })
  applyBenefits(@Body() dto: ApplyBenefitsDto, @CurrentContext() ctx?: RequestContext) {
    return this.insurance.applyBenefits(dto.chargeId, dto.coverageId, {
      ...(dto.onDate ? { onDate: dto.onDate } : {}),
      correlationId: ctx?.correlationId,
    });
  }
}
