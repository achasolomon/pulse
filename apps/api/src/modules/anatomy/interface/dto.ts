import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export const MODEL_STATUSES = ['draft', 'validation', 'active', 'retired'] as const;
export const STRUCTURE_LEVELS = ['system', 'region', 'structure', 'substructure', 'landmark'] as const;
export const LATERALITIES = [
  'left',
  'right',
  'bilateral',
  'midline',
  'not_applicable',
  'unknown',
] as const;
export const SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export const LINK_TARGETS = ['condition', 'observation', 'note', 'document', 'encounter'] as const;

export class CreateModelDto {
  @IsString()
  @Length(1, 100)
  vendor!: string;

  @IsString()
  @Length(1, 100)
  modelName!: string;

  @IsString()
  @Length(1, 50)
  version!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  anatomyProfile?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  structureManifestVersion?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  licence?: string;

  @IsOptional()
  @IsString()
  @Length(0, 128)
  checksum?: string;

  @IsOptional()
  @IsIn(MODEL_STATUSES)
  status?: (typeof MODEL_STATUSES)[number];
}

export class CreateStructureDto {
  @IsString()
  @Length(1, 100)
  vendorStructureKey!: string;

  @IsOptional()
  @IsUUID()
  parentStructureId?: string;

  @IsIn(STRUCTURE_LEVELS)
  level!: (typeof STRUCTURE_LEVELS)[number];

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 50)
  code!: string;
}

export class CreateMappingDto {
  @IsString()
  @Length(1, 50)
  codingSystem!: string;

  @IsString()
  @Length(1, 50)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  codeVersion?: string;

  @IsOptional()
  @IsBoolean()
  approved?: boolean;
}

export class CreateFindingDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  encounterId!: string;

  @IsUUID()
  anatomyModelId!: string;

  @IsUUID()
  anatomyStructureId!: string;

  @IsOptional()
  @IsIn(LATERALITIES)
  laterality?: (typeof LATERALITIES)[number];

  @IsString()
  @Length(1, 50)
  findingType!: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  findingText?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsUUID()
  authorId!: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  geometry?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @Length(1, 100)
  clientRef?: string;
}

export class UpdateFindingDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsIn(LATERALITIES)
  laterality?: (typeof LATERALITIES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 50)
  findingType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  findingText?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  geometry?: Record<string, unknown>[];
}

export class SignFindingDto {
  @IsUUID()
  signedBy!: string;
}

export class AmendFindingDto {
  @IsString()
  @Length(3, 500)
  amendmentReason!: string;

  @IsUUID()
  authorId!: string;

  @IsOptional()
  @IsIn(LATERALITIES)
  laterality?: (typeof LATERALITIES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 50)
  findingType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  findingText?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  geometry?: Record<string, unknown>[];
}

export class EnterErrorDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class LinkFindingDto {
  @IsIn(LINK_TARGETS)
  targetType!: (typeof LINK_TARGETS)[number];

  @IsUUID()
  targetId!: string;
}
