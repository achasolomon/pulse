import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { RequirePrivilege } from './require-privilege.decorator.js';
import { StaffAuthService } from '../application/staff-auth.service.js';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterStaffDto {
  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsString()
  loginId!: string;

  @IsString()
  @Length(10, 200)
  secret!: string;
}

export class StaffLoginDto {
  @IsString()
  loginId!: string;

  @IsString()
  secret!: string;

  @IsOptional()
  @IsString()
  totp?: string;
}

export class ConfirmTotpDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class LinkIdentityDto {
  @IsUUID()
  personId!: string;

  @IsString()
  provider!: string;

  @IsString()
  subject!: string;
}

/**
 * Staff authentication surface (EPIC-03 F03.1). Registration is staff-gated;
 * login is public + throttled; TOTP enrollment requires an authenticated
 * staff context in production (simplified here to credential ownership via
 * an existing session is a Phase-2 hardening item — enrollment is audited).
 */
@Controller('iam/auth')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post('register')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'iam' })
  @Audited({ action: 'staff.register', resourceType: 'staff_credential' })
  register(@Body() dto: RegisterStaffDto) {
    return this.auth.register({
      ...(dto.personId ? { personId: dto.personId } : {}),
      ...(dto.accountName ? { accountName: dto.accountName } : {}),
      loginId: dto.loginId,
      secret: dto.secret,
    });
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: StaffLoginDto) {
    return this.auth.login({
      loginId: dto.loginId,
      secret: dto.secret,
      ...(dto.totp ? { totp: dto.totp } : {}),
    });
  }

  @Post('logout')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  logout(@Headers('authorization') authorization?: string) {
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!header?.startsWith('Bearer staff_')) {
      throw new UnauthorizedException({
        code: 'STAFF_SESSION_INVALID',
        message: 'Logout requires a staff session token',
      });
    }
    return this.auth.logoutByToken(header.slice('Bearer '.length));
  }

  @Post('credentials/:id/totp/enroll')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'iam' })
  @Audited({ action: 'staff.totp_enroll', resourceType: 'staff_credential' })
  enroll(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.auth.enrollTotp(id);
  }

  @Post('credentials/:id/totp/confirm')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'iam' })
  @Audited({ action: 'staff.totp_confirm', resourceType: 'staff_credential' })
  confirm(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ConfirmTotpDto) {
    return this.auth.confirmTotp(id, dto.code);
  }

  @Post('identity-link')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'manage', resourceType: 'iam' })
  @Audited({ action: 'staff.identity_link', resourceType: 'identity_link' })
  link(@Body() dto: LinkIdentityDto) {
    // SSO seam: mapping only; federation protocol lands with the adapter.
    return this.auth.linkIdentity(dto);
  }
}
