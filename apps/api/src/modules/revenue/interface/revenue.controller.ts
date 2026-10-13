import {
  Body,
  Controller,
  Get,
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
import { RevenueService } from '../application/revenue.service.js';
import { BillingProjector } from '../application/billing-projector.service.js';
import { AdjustDto,
  AuthorizeDto,
  CaptureChargeDto,
  CoverageDto,
  CreateInvoiceDto,
  DefineServiceDto,
  DenyClaimDto,
  FileClaimDto,
  PayDto,
} from './dto.js';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AllocationShareDto {
  @IsString()
  partyType!: 'patient' | 'payer' | 'guarantor';

  @IsString()
  partyRef!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  sharePct!: number;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsUUID()
  tariffId?: string;
}

export class AllocateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationShareDto)
  shares!: AllocationShareDto[];
}

export class AssembleLinesDto {
  @IsUUID()
  invoiceId!: string;
}

export class SubmitVersionDto {
  @IsOptional()
  @IsString()
  payerClaimId?: string;
}

export class DefineRuleDto {
  @IsString()
  eventType!: string;

  @IsOptional()
  @IsString()
  serviceCode?: string;

  @IsOptional()
  @IsString()
  codeField?: string;

  @IsOptional()
  quantity?: number;
}

/** Revenue endpoints (EPIC-14). All tenant-scoped + audited. Clinical state never touched. */
@Controller('revenue')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class RevenueController {
  constructor(
    private readonly revenue: RevenueService,
    private readonly projector: BillingProjector,
  ) {}

  @Post('services')
  @RequirePrivilege({ action: 'manage', resourceType: 'billing' })
  @Audited({ action: 'billing.service_define', resourceType: 'service_catalog' })
  defineService(@Body() dto: DefineServiceDto) {
    return this.revenue.defineService({
      code: dto.code,
      name: dto.name,
      defaultPrice: dto.defaultPrice,
    });
  }

  @Post('charges')
  @RequirePrivilege({ action: 'capture', resourceType: 'charge' })
  @Audited({ action: 'charge.capture', resourceType: 'charge' })
  captureCharge(@Body() dto: CaptureChargeDto, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.captureCharge({
      patientId: dto.patientId,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      serviceCode: dto.serviceCode,
      quantity: dto.quantity,
      ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('invoices')
  @RequirePrivilege({ action: 'invoice', resourceType: 'billing' })
  @Audited({ action: 'invoice.create', resourceType: 'invoice' })
  invoice(@Body() dto: CreateInvoiceDto, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.invoice({
      patientId: dto.patientId,
      chargeIds: dto.chargeIds,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('invoices/:id/balance')
  @RequirePrivilege({ action: 'read', resourceType: 'billing' })
  balance(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.revenue.balance(id);
  }

  @Post('invoices/:id/payments')
  @RequirePrivilege({ action: 'collect', resourceType: 'payment' })
  @Audited({ action: 'payment.record', resourceType: 'payment' })
  pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.pay(id, {
      amount: dto.amount,
      method: dto.method ?? 'cash',
      correlationId: ctx?.correlationId,
    });
  }

  @Post('invoices/:id/adjustments')
  @RequirePrivilege({ action: 'adjust', resourceType: 'billing' })
  @Audited({ action: 'invoice.adjust', resourceType: 'invoice' })
  adjust(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdjustDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.adjust(id, {
      amount: dto.amount,
      kind: dto.kind,
      reason: dto.reason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('coverage')
  @RequirePrivilege({ action: 'manage', resourceType: 'coverage' })
  @Audited({ action: 'coverage.add', resourceType: 'coverage' })
  coverage(@Body() dto: CoverageDto) {
    return this.revenue.addCoverage({
      patientId: dto.patientId,
      payer: dto.payer,
      plan: dto.plan,
      memberId: dto.memberId,
      effectiveFrom: dto.effectiveFrom,
      ...(dto.effectiveTo ? { effectiveTo: dto.effectiveTo } : {}),
    });
  }

  @Get('coverage/eligibility')
  @RequirePrivilege({ action: 'read', resourceType: 'coverage' })
  eligibility(@Query('patientId') patientId: string, @Query('onDate') onDate: string) {
    return this.revenue.eligibility(patientId, onDate);
  }

  @Post('authorizations')
  @RequirePrivilege({ action: 'authorize', resourceType: 'coverage' })
  @Audited({ action: 'coverage.authorize', resourceType: 'authorization' })
  authorize(@Body() dto: AuthorizeDto) {
    return this.revenue.authorize({
      coverageId: dto.coverageId,
      encounterId: dto.encounterId,
      approvedAmount: dto.approvedAmount,
      status: dto.status,
    });
  }

  @Post('claims')
  @RequirePrivilege({ action: 'file', resourceType: 'claim' })
  @Audited({ action: 'claim.file', resourceType: 'claim' })
  fileClaim(@Body() dto: FileClaimDto, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.fileClaim(dto.invoiceId, dto.payer, {
      correlationId: ctx?.correlationId,
    });
  }

  @Post('claims/:id/submit')
  @RequirePrivilege({ action: 'submit', resourceType: 'claim' })
  @Audited({ action: 'claim.submit', resourceType: 'claim' })
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.submitClaim(id, { correlationId: ctx?.correlationId });
  }

  @Post('claims/:id/acknowledge')
  @RequirePrivilege({ action: 'acknowledge', resourceType: 'claim' })
  @Audited({ action: 'claim.acknowledge', resourceType: 'claim' })
  acknowledge(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.acknowledgeClaim(id, { correlationId: ctx?.correlationId });
  }

  @Post('claims/:id/pay')
  @RequirePrivilege({ action: 'pay', resourceType: 'claim' })
  @Audited({ action: 'claim.pay', resourceType: 'claim' })
  payClaim(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.payClaim(id, { correlationId: ctx?.correlationId });
  }

  @Post('claims/:id/deny')
  @RequirePrivilege({ action: 'deny', resourceType: 'claim' })
  @Audited({ action: 'claim.deny', resourceType: 'claim' })
  deny(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DenyClaimDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.denyClaim(id, {
      denialReason: dto.denialReason,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('claims/:id/appeal')
  @RequirePrivilege({ action: 'appeal', resourceType: 'claim' })
  @Audited({ action: 'claim.appeal', resourceType: 'claim' })
  appeal(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.appealClaim(id, { correlationId: ctx?.correlationId });
  }

  @Post('charges/:id/allocate')
  @RequirePrivilege({ action: 'allocate', resourceType: 'billing' })
  @Audited({ action: 'charge.allocate', resourceType: 'charge' })
  allocate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AllocateDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.allocate(
      id,
      dto.shares.map((s) => ({
        partyType: s.partyType,
        partyRef: s.partyRef,
        sharePct: s.sharePct,
        amount: s.amount,
        ...(s.tariffId ? { tariffId: s.tariffId } : {}),
      })),
      { correlationId: ctx?.correlationId },
    );
  }

  @Get('invoices/:id/outstanding-by-party')
  @RequirePrivilege({ action: 'read', resourceType: 'billing' })
  outstandingByParty(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.revenue.outstandingByParty(id);
  }

  @Post('claims/:id/lines')
  @RequirePrivilege({ action: 'assemble', resourceType: 'claim' })
  @Audited({ action: 'claim.assemble', resourceType: 'claim' })
  assembleLines(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssembleLinesDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.assembleClaimLines(id, dto.invoiceId, {
      correlationId: ctx?.correlationId,
    });
  }

  @Post('claims/:id/submissions')
  @RequirePrivilege({ action: 'submit', resourceType: 'claim' })
  @Audited({ action: 'claim.submit_version', resourceType: 'claim' })
  submitVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SubmitVersionDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.revenue.submitVersion(id, {
      ...(dto.payerClaimId ? { payerClaimId: dto.payerClaimId } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('claims/:id/submissions')
  @RequirePrivilege({ action: 'read', resourceType: 'claim' })
  submissions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.revenue.claimVersions(id);
  }

  @Post('billing-rules')
  @RequirePrivilege({ action: 'manage', resourceType: 'billing' })
  @Audited({ action: 'billing.rule_define', resourceType: 'billing_rule' })
  defineRule(@Body() dto: DefineRuleDto, @CurrentContext() ctx?: RequestContext) {
    return this.revenue.defineRule({
      eventType: dto.eventType,
      ...(dto.serviceCode ? { serviceCode: dto.serviceCode } : {}),
      ...(dto.codeField ? { codeField: dto.codeField } : {}),
      ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('billing-rules')
  @RequirePrivilege({ action: 'read', resourceType: 'billing' })
  billingRules() {
    return this.revenue.activeRules();
  }

  @Post('project')
  @RequirePrivilege({ action: 'project', resourceType: 'billing' })
  @Audited({ action: 'billing.project', resourceType: 'billing_run' })
  project(@CurrentContext() ctx?: RequestContext) {
    return this.projector.project({ correlationId: ctx?.correlationId });
  }
}
