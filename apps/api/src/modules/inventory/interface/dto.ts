import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, Length } from 'class-validator';

export class DefineItemDto {
  @IsString()
  code!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsString()
  baseUnit!: string;
}

export class CreateLocationDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  name!: string;

  @IsString()
  code!: string;
}

export class ReceiveDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @IsNumber()
  @IsPositive()
  quantityBase!: number;

  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  expiresOn?: string;
}

export class IssueDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @IsNumber()
  @IsPositive()
  quantityBase!: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ReconcileDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @IsNumber()
  counted!: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ProcureDto {
  @IsUUID()
  facilityId!: string;

  @IsUUID()
  itemId!: string;

  @IsNumber()
  @IsPositive()
  quantityBase!: number;

  @IsUUID()
  locationId!: string;

  @IsString()
  supplier!: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;
}
