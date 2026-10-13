import { IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class RegisterPatientDto {
  @IsString()
  @Length(1, 120)
  familyName!: string;

  @IsString()
  @Length(1, 120)
  givenName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsIn(['M', 'F', 'O', 'U'])
  sex!: 'M' | 'F' | 'O' | 'U';

  @IsString()
  facilityId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  mrn?: string;
}

export class MergePatientDto {
  @IsString()
  survivorId!: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class SetGuarantorDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  contact?: string;
}
