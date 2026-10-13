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
import { BloodbankService } from '../application/bloodbank.service.js';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterUnitDto {
  @IsString()
  bagId!: string;

  @IsIn(['O', 'A', 'B', 'AB'])
  abo!: 'O' | 'A' | 'B' | 'AB';

  @IsIn(['+', '-'])
  rh!: '+' | '-';

  @IsString()
  expiresOn!: string;
}

export class CrossmatchDto {
  @IsUUID()
  patientId!: string;

  @IsIn(['O', 'A', 'B', 'AB'])
  recipientAbo!: 'O' | 'A' | 'B' | 'AB';

  @IsIn(['+', '-'])
  recipientRh!: '+' | '-';

  @IsOptional()
  @IsUUID()
  performedBy?: string;
}

export class IssueDto {
  @IsUUID()
  patientId!: string;
}

export class StartTransfusionDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  unitId!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;
}

export class FinishTransfusionDto {
  @IsOptional()
  @IsIn(['none', 'mild', 'moderate', 'severe'])
  reaction?: 'none' | 'mild' | 'moderate' | 'severe';

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  note?: string;
}

/** Blood bank endpoints (R6). Incompatibility can never proceed. */
@Controller('bloodbank')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class BloodbankController {
  constructor(private readonly bank: BloodbankService) {}

  @Post('units')
  @RequirePrivilege({ action: 'register', resourceType: 'blood' })
  @Audited({ action: 'blood.register', resourceType: 'blood_unit' })
  register(@Body() dto: RegisterUnitDto) {
    return this.bank.registerUnit({
      bagId: dto.bagId,
      abo: dto.abo,
      rh: dto.rh,
      expiresOn: dto.expiresOn,
    });
  }

  @Post('units/:id/test')
  @RequirePrivilege({ action: 'test', resourceType: 'blood' })
  @Audited({ action: 'blood.test', resourceType: 'blood_unit' })
  test(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.bank.testUnit(id, { correlationId: ctx?.correlationId });
  }

  @Post('units/:id/release')
  @RequirePrivilege({ action: 'release', resourceType: 'blood' })
  @Audited({ action: 'blood.release', resourceType: 'blood_unit' })
  release(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.bank.releaseUnit(id, { correlationId: ctx?.correlationId });
  }

  @Post('units/:id/crossmatch')
  @RequirePrivilege({ action: 'crossmatch', resourceType: 'blood' })
  @Audited({ action: 'blood.crossmatch', resourceType: 'blood_unit' })
  crossmatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CrossmatchDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.bank.crossmatch({
      patientId: dto.patientId,
      unitId: id,
      recipientAbo: dto.recipientAbo,
      recipientRh: dto.recipientRh,
      ...(dto.performedBy ? { performedBy: dto.performedBy } : {}),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('units/:id/issue')
  @RequirePrivilege({ action: 'issue', resourceType: 'blood' })
  @Audited({ action: 'blood.issue', resourceType: 'blood_unit' })
  issue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.bank.issue({ unitId: id, patientId: dto.patientId, correlationId: ctx?.correlationId });
  }

  @Post('transfusions')
  @RequirePrivilege({ action: 'transfuse', resourceType: 'blood' })
  @Audited({ action: 'transfusion.start', resourceType: 'transfusion' })
  start(@Body() dto: StartTransfusionDto, @CurrentContext() ctx?: RequestContext) {
    return this.bank.startTransfusion({
      patientId: dto.patientId,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      unitId: dto.unitId,
      correlationId: ctx?.correlationId,
    });
  }

  @Post('transfusions/:id/finish')
  @RequirePrivilege({ action: 'transfuse', resourceType: 'blood' })
  @Audited({ action: 'transfusion.finish', resourceType: 'transfusion' })
  finish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FinishTransfusionDto,
    @CurrentContext() ctx?: RequestContext,
  ) {
    return this.bank.finishTransfusion(id, {
      ...(dto.reaction ? { reaction: dto.reaction } : {}),
      ...(dto.note ? { note: dto.note } : {}),
      correlationId: ctx?.correlationId,
    });
  }
}
