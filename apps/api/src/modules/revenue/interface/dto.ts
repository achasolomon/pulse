import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length } from 'class-validator';

export class DefineServiceDto {
  @IsString()
  code!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsNumber()
  @IsPositive()
  defaultPrice!: number;
}

export class CaptureChargeDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @IsString()
  serviceCode!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPrice?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  patientId!: string;

  @IsString({ each: true })
  chargeIds!: string[];
}

export class PayDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  method?: string;
}

export class AdjustDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn(['refund', 'write-off', 'correction'])
  kind!: 'refund' | 'write-off' | 'correction';

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CoverageDto {
  @IsUUID()
  patientId!: string;

  @IsString()
  payer!: string;

  @IsString()
  plan!: string;

  @IsString()
  memberId!: string;

  @IsString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  effectiveTo?: string;
}

export class AuthorizeDto {
  @IsUUID()
  coverageId!: string;

  @IsUUID()
  encounterId!: string;

  @IsNumber()
  approvedAmount!: number;

  @IsIn(['approved', 'denied'])
  status!: 'approved' | 'denied';
}

export class FileClaimDto {
  @IsUUID()
  invoiceId!: string;

  @IsString()
  payer!: string;
}

export class DenyClaimDto {
  @IsString()
  @Length(3, 500)
  denialReason!: string;
}
