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
import { EmergencyService } from '../application/emergency.service.js';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class ScoreAcuityDto {
  @IsUUID()
  encounterId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  level!: 1 | 2 | 3 | 4 | 5;

  @IsString()
  @Length(3, 1000)
  discriminator!: string;

  @IsOptional()
  @IsString()
  overrideReason?: string;
}

export class EmergencyDischargeDto {
  @IsOptional()
  @IsString()
  @IsIn(['home', 'admitted', 'transferred', 'expired', 'against-advice'])
  disposition?: string;
}

/** Emergency endpoints (R6 slice). */
@Controller('emergency')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Post('acuity')
  @RequirePrivilege({ action: 'score', resourceType: 'emergency' })
  @Audited({ action: 'emergency.score', resourceType: 'encounter' })
  score(@Body() dto: ScoreAcuityDto, @CurrentContext() ctx?: RequestContext) {
    return this.emergency.score({
      encounterId: dto.encounterId,
      level: dto.level,
      discriminator: dto.discriminator,
      ...(dto.overrideReason ? { overrideReason: dto.overrideReason } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Get('waiting')
  @RequirePrivilege({ action: 'read', resourceType: 'emergency' })
  waiting(@Query('facilityId') facilityId: string) {
    return this.emergency.waiting(facilityId);
  }

  @Post('encounters/:id/discharge')
  @RequirePrivilege({ action: 'discharge', resourceType: 'encounter' })
  @Audited({ action: 'emergency.discharge', resourceType: 'encounter' })
  discharge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EmergencyDischargeDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.emergency.dischargeWithAcuity(id, {
      ...(dto.disposition ? { disposition: dto.disposition } : {}),
      correlationId: ctx?.correlationId,
    });
  }
}
