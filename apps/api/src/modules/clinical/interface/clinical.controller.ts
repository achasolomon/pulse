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
import { ClinicalService } from '../application/clinical.service.js';
import {
  CLINICAL_REPOSITORY,
  type ClinicalRepository,
} from '../domain/clinical.repository.js';
import { AddendumDto, DraftNoteDto, RecordEntryDto, RecordVitalsDto } from './dto.js';

/** Clinical endpoints (EPIC-07 triage/vitals, EPIC-08 notes/problems). */
@Controller('clinical')
@UseGuards(TenantContextGuard, AuthorizationGuard)
export class ClinicalController {
  constructor(
    private readonly clinical: ClinicalService,
    @Inject(CLINICAL_REPOSITORY) private readonly repo: ClinicalRepository,
  ) {}

  @Post('vitals')
  @RequirePrivilege({ action: 'write', resourceType: 'observation' })
  @Audited({ action: 'observation.record', resourceType: 'observation' })
  vitals(@Body() dto: RecordVitalsDto, @CurrentContext() ctx?: RequestContext) {
    return this.clinical.recordVitals({
      observations: dto.observations.map((o) => ({
        patientId: o.patientId,
        ...(o.encounterId ? { encounterId: o.encounterId } : {}),
        code: o.code,
        ...(o.valueNum !== undefined ? { valueNum: o.valueNum } : {}),
        ...(o.valueText ? { valueText: o.valueText } : {}),
        ...(o.unit ? { unit: o.unit } : {}),
      })),
      correlationId: ctx?.correlationId,
    });
  }

  @Post('notes')
  @RequirePrivilege({ action: 'write', resourceType: 'note' })
  @Audited({ action: 'note.draft', resourceType: 'note' })
  draft(@Body() dto: DraftNoteDto, @CurrentContext() ctx?: RequestContext) {
    return this.clinical.draftNote({
      patientId: dto.patientId,
      encounterId: dto.encounterId,
      chiefComplaint: dto.chiefComplaint,
      history: dto.history ?? '',
      examination: dto.examination ?? '',
      assessment: dto.assessment ?? '',
      plan: dto.plan ?? '',
      correlationId: ctx?.correlationId,
    });
  }

  @Post('notes/:id/sign')
  @RequirePrivilege({ action: 'sign', resourceType: 'note' })
  @Audited({ action: 'note.sign', resourceType: 'note' })
  sign(@Param('id', new ParseUUIDPipe()) id: string, @CurrentContext() ctx?: RequestContext) {
    return this.clinical.signNote(id, { correlationId: ctx?.correlationId });
  }

  @Post('notes/:id/addenda')
  @RequirePrivilege({ action: 'amend', resourceType: 'note' })
  @Audited({ action: 'note.addendum', resourceType: 'note' })
  addendum(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddendumDto) {
    return this.clinical.addAddendum(id, dto.text);
  }

  @Post('entries')
  @RequirePrivilege({ action: 'write', resourceType: 'entry' })
  @Audited({ action: 'entry.record', resourceType: 'entry' })
  entry(@Body() dto: RecordEntryDto, @CurrentContext() ctx?: RequestContext) {
    return this.clinical.recordEntry({
      patientId: dto.patientId,
      ...(dto.encounterId ? { encounterId: dto.encounterId } : {}),
      kind: dto.kind,
      ...(dto.code ? { code: dto.code } : {}),
      display: dto.display,
      correlationId: ctx?.correlationId,
    });
  }

  @Get('patients/:id/timeline')
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  timeline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    return this.repo.timeline(id, n);
  }

  @Get('handovers')
  @RequirePrivilege({ action: 'read', resourceType: 'handover' })
  handover(@Query('facilityId') facilityId: string) {
    return this.clinical.handover(facilityId);
  }

  @Get('patients/:id/export')
  @RequirePrivilege({ action: 'export', resourceType: 'patient' })
  @Audited({ action: 'patient.export', resourceType: 'patient' })
  patientExport(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.clinical.exportBundle(id);
  }
}
