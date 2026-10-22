import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { AccountSecurityService } from '../application/account-security.service.js';
import { StaffSessionGuard } from './staff-session.guard.js';
class ResetRequestDto {
  @IsString() @Length(1, 200) loginId!: string;
}
class ResetConfirmDto {
  @IsString() @Length(43, 43) token!: string;
  @IsString() @Length(10, 200) secret!: string;
}
class PasswordDto {
  @IsString() @Length(1, 200) secret!: string;
}
class CodeDto {
  @IsString() @Matches(/^[0-9]{6}$/) totp!: string;
}
class DisableDto extends PasswordDto {
  @IsString() @Matches(/^[0-9]{6}$/) totp!: string;
}
class EmailDto extends PasswordDto {
  @IsEmail() @Length(3, 254) email!: string;
  @IsOptional() @IsString() @Matches(/^[0-9]{6}$/) totp?: string;
}
class VerifyEmailDto {
  @IsString() @Length(43, 43) token!: string;
}
// Public recovery is throttled/non-enumerating. Settings methods independently
// validate the actual staff session and bind changes to its credential only.
@Controller('iam/auth/account')
@Throttle({ default: { limit: 5, ttl: 60000 } })
export class AccountSecurityController {
  constructor(private readonly security: AccountSecurityService) {}
  @Get('security')
  @UseGuards(StaffSessionGuard)
  @Header('Cache-Control', 'no-store')
  status(@Headers('authorization') auth?: string) {
    return this.security.status(auth);
  }
  @Post('password/request')
  request(@Body() body: ResetRequestDto) {
    return this.security.requestReset(body.loginId);
  }
  @Post('password/reset')
  reset(@Body() body: ResetConfirmDto) {
    return this.security.finishReset(body.token, body.secret);
  }
  @Post('email/request')
  @UseGuards(StaffSessionGuard)
  email(
    @Headers('authorization') auth: string | undefined,
    @Body() body: EmailDto,
  ) {
    return this.security.requestEmail(auth, body.email, body.secret, body.totp);
  }
  @Post('email/verify')
  @UseGuards(StaffSessionGuard)
  verify(
    @Headers('authorization') auth: string | undefined,
    @Body() body: VerifyEmailDto,
  ) {
    return this.security.verifyEmail(auth, body.token);
  }
  @Post('mfa/enroll')
  @UseGuards(StaffSessionGuard)
  enroll(
    @Headers('authorization') auth: string | undefined,
    @Body() body: PasswordDto,
  ) {
    return this.security.enroll(auth, body.secret);
  }
  @Post('mfa/confirm')
  @UseGuards(StaffSessionGuard)
  confirm(
    @Headers('authorization') auth: string | undefined,
    @Body() body: CodeDto,
  ) {
    return this.security.confirm(auth, body.totp);
  }
  @Post('mfa/disable')
  @UseGuards(StaffSessionGuard)
  disable(
    @Headers('authorization') auth: string | undefined,
    @Body() body: DisableDto,
  ) {
    return this.security.disable(auth, body.secret, body.totp);
  }
}
