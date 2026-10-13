import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class DefineTestDto {
  @IsString()
  code!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsOptional()
  @IsString()
  specimenRequirement?: string;
}

export class PlaceOrderDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  encounterId!: string;

  @IsString()
  testCode!: string;

  @IsOptional()
  @IsIn(['stat', 'urgent', 'routine'])
  urgency?: 'stat' | 'urgent' | 'routine';

  @IsOptional()
  @IsString()
  indication?: string;
}

export class CollectDto {
  @IsString()
  container!: string;

  @IsString()
  label!: string;
}

export class ResultDto {
  @IsString()
  component!: string;

  @IsString()
  valueText!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsIn(['normal', 'high', 'low', 'critical'])
  flag?: 'normal' | 'high' | 'low' | 'critical';
}

export class VerifyDto {
  @IsUUID()
  verifiedBy!: string;
}

export class CancelOrderDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AckDto {
  @IsUUID()
  ackBy!: string;
}
