import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

const CODE_RE = /^[A-Z0-9-]{2,32}$/;

export class CreateOrganizationDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must match [A-Z0-9-]{2,32}' })
  code!: string;
}

export class CreateFacilityDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must match [A-Z0-9-]{2,32}' })
  code!: string;
}

export class CreateDepartmentDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must match [A-Z0-9-]{2,32}' })
  code!: string;

  @IsOptional()
  @IsString()
  parentDepartmentId?: string;
}

export class CreateUnitDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must match [A-Z0-9-]{2,32}' })
  code!: string;
}

export class CreateLocationDto {
  @IsString()
  unitId!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must match [A-Z0-9-]{2,32}' })
  code!: string;

  @IsString()
  @IsIn(['bed', 'room', 'theatre', 'clinic', 'other'])
  kind!: 'bed' | 'room' | 'theatre' | 'clinic' | 'other';
}
