import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class OpenEncounterDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  facilityId!: string;

  @IsIn(['outpatient', 'inpatient', 'emergency'])
  type!: 'outpatient' | 'inpatient' | 'emergency';
}

export class AdmitDto {
  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsString()
  bed?: string;
}

export class TransferDto {
  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsString()
  bed?: string;
}

export class DischargeDto {
  @IsOptional()
  @IsString()
  disposition?: string;
}

export class SetCoverageDto {
  @IsUUID()
  coverageId!: string;
}
