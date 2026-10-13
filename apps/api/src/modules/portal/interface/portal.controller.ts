import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { PortalService } from '../application/portal.service.js';
import { PortalReadsService } from '../application/portal-reads.service.js';
import { PatientSessionGuard } from './patient-session.guard.js';
import { Throttle } from '@nestjs/throttler';
import { currentPortalContext, type PortalContext } from './portal-context.js';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export const CurrentPortal = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): PortalContext | undefined =>
    currentPortalContext(),
);

export class RegisterPortalDto {
  @IsUUID()
  patientId!: string;

  @IsString()
  loginId!: string;

  @IsString()
  @Length(8, 200)
  secret!: string;
}

export class LoginDto {
  @IsString()
  loginId!: string;

  @IsString()
  secret!: string;
}

export class GrantProxyDto {
  @IsUUID()
  dependentPatientId!: string;

  @IsUUID()
  proxyAccountId!: string;

  @IsOptional()
  @IsString()
  relationship?: string;
}

/** Staff-assisted portal administration (account + proxy setup). */
@Controller('portal/admin')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class PortalAdminController {
  constructor(private readonly portal: PortalService) {}

  @Post('accounts')
  @RequirePrivilege({ action: 'manage', resourceType: 'patient' })
  @Audited({ action: 'portal.register', resourceType: 'portal_account' })
  register(@Body() dto: RegisterPortalDto) {
    return this.portal.register({
      patientId: dto.patientId,
      loginId: dto.loginId,
      secret: dto.secret,
    });
  }

  @Post('proxy')
  @RequirePrivilege({ action: 'manage', resourceType: 'patient' })
  @Audited({ action: 'portal.proxy_grant', resourceType: 'portal_proxy' })
  grant(@Body() dto: GrantProxyDto) {
    return this.portal.grantProxy({
      dependentPatientId: dto.dependentPatientId,
      proxyAccountId: dto.proxyAccountId,
      relationship: dto.relationship ?? '',
    });
  }
}

/** Patient self-service surface. Session-scoped reads only. */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly reads: PortalReadsService,
  ) {}

  @Post('auth/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.portal.login({ loginId: dto.loginId, secret: dto.secret });
  }

  @Post('auth/act-as')
  @UseGuards(PatientSessionGuard)
  actAs(@Body() dto: { dependentPatientId: string }, @CurrentPortal() ctx?: PortalContext) {
    if (!ctx) throw new Error('unreachable');
    return this.portal.actAs({ proxyAccountId: ctx.accountId, dependentPatientId: dto.dependentPatientId });
  }

  @Post('auth/logout')
  @UseGuards(PatientSessionGuard)
  logout(@CurrentPortal() ctx?: PortalContext) {
    if (!ctx) throw new Error('unreachable');
    return this.portal.logout(ctx.sessionId).then(() => ({ ok: true }));
  }

  @Get('me')
  @UseGuards(PatientSessionGuard)
  me(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.me(ctx?.actingPatientId ?? '');
  }

  @Get('appointments')
  @UseGuards(PatientSessionGuard)
  appointments(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.appointments(ctx?.actingPatientId ?? '');
  }

  @Get('timeline')
  @UseGuards(PatientSessionGuard)
  timeline(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.timeline(ctx?.actingPatientId ?? '');
  }

  @Get('prescriptions')
  @UseGuards(PatientSessionGuard)
  prescriptions(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.prescriptions(ctx?.actingPatientId ?? '');
  }

  @Get('invoices')
  @UseGuards(PatientSessionGuard)
  invoices(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.invoices(ctx?.actingPatientId ?? '');
  }

  @Get('invoices/:id/balance')
  @UseGuards(PatientSessionGuard)
  invoiceBalance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPortal() ctx?: PortalContext,
  ) {
    return this.reads.invoiceBalance(ctx?.actingPatientId ?? '', id);
  }

  @Get('referrals')
  @UseGuards(PatientSessionGuard)
  referrals(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.referrals(ctx?.actingPatientId ?? '');
  }

  @Get('lab-orders')
  @UseGuards(PatientSessionGuard)
  labOrders(@CurrentPortal() ctx?: PortalContext) {
    return this.reads.labOrders(ctx?.actingPatientId ?? '');
  }
}
