import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  ValidateNested,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecordVitalsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VitalDto)
  observations!: VitalDto[];
}

export class VitalDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsNumber()
  valueNum?: number;

  @IsOptional()
  @IsString()
  valueText?: string;

  @IsOptional()
  @IsString()
  unit?: string;
}

export class DraftNoteDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  encounterId!: string;

  @IsString()
  @Length(1, 2000)
  chiefComplaint!: string;

  @IsOptional()
  @IsString()
  history?: string;

  @IsOptional()
  @IsString()
  examination?: string;

  @IsOptional()
  @IsString()
  assessment?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}

export class AddendumDto {
  @IsString()
  @Length(3, 4000)
  text!: string;
}

export class RecordEntryDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @IsIn(['problem', 'allergy', 'diagnosis'])
  kind!: 'problem' | 'allergy' | 'diagnosis';

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @Length(1, 300)
  display!: string;
}
