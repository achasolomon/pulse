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
import { ConsentService } from '../application/consent.service.js';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CaptureConsentDto {
  @IsUUID()
  patientId!: string;

  @IsString()
  grantee!: string;

  @IsIn(['treatment', 'referral', 'billing', 'research', 'operations'])
  purpose!: 'treatment' | 'referral' | 'billing' | 'research' | 'operations';

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  validTo?: string;
}

export class WithdrawDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** Consent endpoints (EPIC-16). */
@Controller('consent')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post()
  @RequirePrivilege({ action: 'capture', resourceType: 'consent' })
  @Audited({ action: 'consent.capture', resourceType: 'consent' })
  capture(@Body() dto: CaptureConsentDto, @CurrentContext() ctx?: RequestContext) {
    return this.consent.capture({
      patientId: dto.patientId,
      grantee: dto.grantee,
      purpose: dto.purpose,
      scope: dto.scope ?? 'clinical-summary',
      ...(dto.validTo ? { validTo: dto.validTo } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post(':id/withdraw')
  @RequirePrivilege({ action: 'withdraw', resourceType: 'consent' })
  @Audited({ action: 'consent.withdraw', resourceType: 'consent' })
  withdraw(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WithdrawDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.consent.withdraw(id, dto.reason, { correlationId: ctx?.correlationId });
  }
}
