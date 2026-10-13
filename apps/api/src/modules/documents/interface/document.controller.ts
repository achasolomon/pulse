import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { DocumentService } from '../application/document.service.js';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from '../domain/document.repository.js';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterDocumentDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @IsString()
  @Length(1, 300)
  name!: string;

  @IsString()
  mime!: string;

  @IsString()
  @Length(1, 500)
  storageKey!: string;
}

/** Document endpoints (EPIC-15 F15.3). Metadata only; bytes live in object storage. */
@Controller('documents')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class DocumentController {
  constructor(
    private readonly documents: DocumentService,
    @Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository,
  ) {}

  @Post()
  @RequirePrivilege({ action: 'upload', resourceType: 'document' })
  @Audited({ action: 'document.register', resourceType: 'document' })
  register(@Body() dto: RegisterDocumentDto, @CurrentContext() ctx?: RequestContext) {
    return this.documents.register({
      ...(dto.patientId ? { patientId: dto.patientId } : {}),
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      name: dto.name,
      mime: dto.mime,
      storageKey: dto.storageKey,
      correlationId: ctx?.correlationId,
    });
  }

  @Get()
  @RequirePrivilege({ action: 'read', resourceType: 'document' })
  list(@Query('patientId') patientId: string) {
    return this.repo.listForPatient(patientId, 50);
  }

  @Get(':id')
  @RequirePrivilege({ action: 'read', resourceType: 'document' })
  get(@Param('id', new ParseUUIDPipe()) _id: string) {
    // Metadata read-through: full byte serving via signed S3 URLs lands with the storage adapter.
    return { download: 'signed-url-pending' };
  }
}
