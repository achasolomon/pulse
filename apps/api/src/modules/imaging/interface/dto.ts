import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class PlaceImagingOrderDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  encounterId!: string;

  @IsString()
  procedureCode!: string;

  @IsString()
  bodyRegion!: string;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'na'])
  laterality?: string;

  @IsOptional()
  @IsString()
  indication?: string;

  @IsOptional()
  @IsIn(['stat', 'urgent', 'routine'])
  urgency?: 'stat' | 'urgent' | 'routine';
}

export class AcquireDto {
  @IsString()
  studyUid!: string;

  @IsOptional()
  @IsString()
  accession?: string;

  @IsOptional()
  @IsString()
  modality?: string;

  @IsOptional()
  @IsString()
  pacsRef?: string;
}

export class ImagingReportDto {
  @IsString()
  @Length(3, 10000)
  text!: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;
}

export class CancelImagingDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
