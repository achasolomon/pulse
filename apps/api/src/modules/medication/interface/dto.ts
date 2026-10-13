import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class DefineMedicationDto {
  @IsString()
  code!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsOptional()
  @IsString()
  doseForm?: string;

  @IsOptional()
  @IsString()
  strength?: string;

  @IsOptional()
  @IsString()
  route?: string;
}

export class PrescribeDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  encounterId!: string;

  @IsString()
  medicationCode!: string;

  @IsString()
  dose!: string;

  @IsOptional()
  @IsString()
  doseUnit?: string;

  @IsString()
  route!: string;

  @IsString()
  frequency!: string;
}

export class DispenseDto {
  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  batch?: string;
}

export class HoldCancelDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AdministerDto {
  @IsString()
  doseGiven!: string;

  @IsIn(['given', 'not-given', 'held'])
  outcome!: 'given' | 'not-given' | 'held';

  @IsOptional()
  @IsString()
  reason?: string;
}
