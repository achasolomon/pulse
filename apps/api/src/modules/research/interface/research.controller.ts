import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import { RequirePrivilege } from '../../iam/interface/require-privilege.decorator.js';
import { ResearchService } from '../application/research.service.js';

export class CreateStudyDto {
  @IsUUID()
  facilityId!: string;

  @IsString()
  @Length(3, 64)
  code!: string;

  @IsString()
  @Length(3, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;
}

export class ApproveStudyDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Length(3, 120)
  approver!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class CloseStudyDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Length(3, 120)
  actor!: string;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class CreateCohortDto {
  @IsUUID()
  studyId!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(5, 4000)
  criteria!: string;
}

export class RequestExportDto {
  @IsUUID()
  studyId!: string;

  @IsUUID()
  cohortId!: string;

  @IsString()
  @Length(3, 120)
  requestedBy!: string;

  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  patientIds!: string[];
}

export class DecideExportDto {
  @IsUUID()
  id!: string;

  @IsIn(['approved', 'denied'])
  decision!: 'approved' | 'denied';

  @IsString()
  @Length(3, 120)
  decisionBy!: string;

  @IsString()
  @Length(5, 500)
  note!: string;
}

export class IdDto {
  @IsUUID()
  id!: string;
}

export class RevokeExportDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Length(3, 120)
  actor!: string;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

/**
 * Research governance (EPIC-25 final slice, BACKLOG-001: cohort/query
 * governance, de-identification/pseudonymization, approvals, export controls,
 * provenance). Staff surface: research:read / research:manage.
 */
@Controller('research')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('studies')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.study_create', resourceType: 'research' })
  createStudy(@Body() dto: CreateStudyDto) {
    return this.research.createStudy({
      facilityId: dto.facilityId,
      code: dto.code,
      title: dto.title,
      description: dto.description ?? '',
    });
  }

  @Get('studies')
  @RequirePrivilege({ action: 'read', resourceType: 'research' })
  listStudies(
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: string,
  ) {
    return this.research.listStudies({
      ...(facilityId ? { facilityId } : {}),
      ...(status === 'draft' || status === 'approved' || status === 'closed' ? { status } : {}),
    });
  }

  @Get('studies/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'research' })
  getStudy(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.research.getStudy(id);
  }

  @Post('studies/:id/approve')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.study_approve', resourceType: 'research' })
  approveStudy(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ApproveStudyDto) {
    return this.research.approveStudy({
      id,
      approver: dto.approver,
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    });
  }

  @Post('studies/:id/close')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.study_close', resourceType: 'research' })
  closeStudy(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CloseStudyDto) {
    return this.research.closeStudy({ id, actor: dto.actor, reason: dto.reason });
  }

  @Post('cohorts')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.cohort_create', resourceType: 'research' })
  createCohort(@Body() dto: CreateCohortDto) {
    return this.research.createCohort({
      studyId: dto.studyId,
      name: dto.name,
      criteria: dto.criteria,
    });
  }

  @Get('cohorts')
  @RequirePrivilege({ action: 'read', resourceType: 'research' })
  listCohorts(@Query('studyId') studyId: string) {
    return this.research.listCohorts(studyId);
  }

  @Post('cohorts/:id/approve')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.cohort_approve', resourceType: 'research' })
  approveCohort(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.research.approveCohort({ id });
  }

  @Post('exports')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.export_request', resourceType: 'research' })
  requestExport(@Body() dto: RequestExportDto) {
    return this.research.requestExport({
      studyId: dto.studyId,
      cohortId: dto.cohortId,
      requestedBy: dto.requestedBy,
      patientIds: dto.patientIds,
    });
  }

  @Get('exports')
  @RequirePrivilege({ action: 'read', resourceType: 'research' })
  listExports(
    @Query('studyId') studyId?: string,
    @Query('status') status?: string,
  ) {
    const valid = ['requested', 'approved', 'denied', 'exported', 'revoked'] as const;
    const s = valid.find((v) => v === status);
    return this.research.listExports({
      ...(studyId ? { studyId } : {}),
      ...(s !== undefined ? { status: s } : {}),
    });
  }

  @Get('exports/:id')
  @RequirePrivilege({ action: 'read', resourceType: 'research' })
  getExport(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.research.getExportById(id);
  }

  @Post('exports/:id/decide')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.export_decide', resourceType: 'research' })
  decideExport(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecideExportDto) {
    return this.research.decideExport({
      id,
      decision: dto.decision,
      decisionBy: dto.decisionBy,
      note: dto.note,
    });
  }

  @Post('exports/:id/generate')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.export_generate', resourceType: 'research' })
  generateExport(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.research.generateExport({ id });
  }

  @Post('exports/:id/revoke')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  @Audited({ action: 'research.export_revoke', resourceType: 'research' })
  revokeExport(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RevokeExportDto) {
    return this.research.revokeExport({ id, actor: dto.actor, reason: dto.reason });
  }

  /** Re-identification vault: privileged subject list (pseudonym + patient). */
  @Get('studies/:id/subjects')
  @RequirePrivilege({ action: 'manage', resourceType: 'research' })
  listSubjects(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.research.listSubjects(id);
  }
}
