import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ReferralService } from '../application/referral.service.js';
import {
  REFERRAL_REPOSITORY,
  type ReferralRepository,
} from '../domain/referral.repository.js';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateReferralDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  sendingFacilityId!: string;

  @IsOptional()
  @IsUUID()
  receivingFacilityId?: string;

  @IsOptional()
  @IsIn(['routine', 'urgent', 'emergency', 'transfer'])
  type?: string;

  @IsOptional()
  @IsIn(['routine', 'urgent', 'emergency'])
  urgency?: string;

  @IsOptional()
  @IsString()
  clinicalQuestion?: string;
}

export class MessageDto {
  @IsString()
  @Length(1, 4000)
  body!: string;
}

export class CancelReferralDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class RedirectDto {
  @IsUUID()
  receivingFacilityId!: string;
}

/** Referral exchange endpoints (EPIC-17). Consent-gated sends. */
@Controller('referrals')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ReferralController {
  constructor(
    private readonly referrals: ReferralService,
    @Inject(REFERRAL_REPOSITORY) private readonly repo: ReferralRepository,
  ) {}

  @Post()
  @RequirePrivilege({ action: 'create', resourceType: 'referral' })
  @Audited({ action: 'referral.create', resourceType: 'referral_case' })
  create(@Body() dto: CreateReferralDto, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.create({
      patientId: dto.patientId,
      sendingFacilityId: dto.sendingFacilityId,
      ...(dto.receivingFacilityId ? { receivingFacilityId: dto.receivingFacilityId } : {}),
      type: dto.type ?? 'routine',
      urgency: dto.urgency ?? 'routine',
      clinicalQuestion: dto.clinicalQuestion ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Get('inbox')
  @RequirePrivilege({ action: 'read', resourceType: 'referral' })
  inbox(@Query('facilityId') facilityId: string) {
    return this.repo.inbox(facilityId, 50);
  }

  @Get(':id/messages')
  @RequirePrivilege({ action: 'read', resourceType: 'referral' })
  messages(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.repo.messages(id);
  }

  @Post(':id/messages')
  @RequirePrivilege({ action: 'message', resourceType: 'referral' })
  @Audited({ action: 'referral.message', resourceType: 'referral_case' })
  message(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MessageDto) {
    return this.referrals.message(id, dto.body);
  }

  @Post(':id/submit')
  @RequirePrivilege({ action: 'submit', resourceType: 'referral' })
  @Audited({ action: 'referral.submit', resourceType: 'referral_case' })
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.submit(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/acknowledge')
  @RequirePrivilege({ action: 'acknowledge', resourceType: 'referral' })
  @Audited({ action: 'referral.acknowledge', resourceType: 'referral_case' })
  acknowledge(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.acknowledge(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/request-info')
  @RequirePrivilege({ action: 'review', resourceType: 'referral' })
  @Audited({ action: 'referral.request_info', resourceType: 'referral_case' })
  requestInfo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MessageDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.referrals.requestInfo(id, dto.body, undefined, { correlationId: ctx?.correlationId });
  }

  @Post(':id/resubmit')
  @RequirePrivilege({ action: 'submit', resourceType: 'referral' })
  @Audited({ action: 'referral.resubmit', resourceType: 'referral_case' })
  resubmit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.resubmit(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/accept')
  @RequirePrivilege({ action: 'accept', resourceType: 'referral' })
  @Audited({ action: 'referral.accept', resourceType: 'referral_case' })
  accept(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.accept(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/decline')
  @RequirePrivilege({ action: 'decline', resourceType: 'referral' })
  @Audited({ action: 'referral.decline', resourceType: 'referral_case' })
  decline(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.decline(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/schedule')
  @RequirePrivilege({ action: 'schedule', resourceType: 'referral' })
  @Audited({ action: 'referral.schedule', resourceType: 'referral_case' })
  schedule(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.schedule(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/dispatch')
  @RequirePrivilege({ action: 'dispatch', resourceType: 'referral' })
  @Audited({ action: 'referral.dispatch', resourceType: 'referral_case' })
  dispatch(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.dispatch(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/arrive')
  @RequirePrivilege({ action: 'arrive', resourceType: 'referral' })
  @Audited({ action: 'referral.arrive', resourceType: 'referral_case' })
  arrive(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.arrive(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/close')
  @RequirePrivilege({ action: 'close', resourceType: 'referral' })
  @Audited({ action: 'referral.close', resourceType: 'referral_case' })
  close(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.referrals.close(id, { correlationId: ctx?.correlationId });
  }

  @Post(':id/cancel')
  @RequirePrivilege({ action: 'cancel', resourceType: 'referral' })
  @Audited({ action: 'referral.cancel', resourceType: 'referral_case' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelReferralDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.referrals.cancel(id, { reason: dto.reason, correlationId: ctx?.correlationId });
  }

  @Post(':id/redirect')
  @RequirePrivilege({ action: 'redirect', resourceType: 'referral' })
  @Audited({ action: 'referral.redirect', resourceType: 'referral_case' })
  redirect(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RedirectDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.referrals.redirect(id, {
      receivingFacilityId: dto.receivingFacilityId,
      correlationId: ctx?.correlationId,
    });
  }
}
